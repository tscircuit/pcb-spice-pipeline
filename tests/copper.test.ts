import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, fastHenryDeck, fasterCapDeck } from '../src/geometry.js'
import { groundMesh, copperFasterCapDeck, panelAspectLimit, meshPolygon } from '../src/copper.js'
import { groundPlaneFixture, routedGroundPlaneFixture } from './fixtures/ground-plane.js'

function closedSurfaceVolume(surface: string): number {
  assert.match(surface.split('\n')[0], /\bmillimetres\b/)
  const panels = surface.split('\n').filter(r => /^[TQ] /.test(r)).map(row => {
    const values = row.split(' ').slice(2).map(value => Number(value) * 1e-3)
    return Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3))
  })
  const key = (p: number[]) => p.map(n => n.toPrecision(12)).join(',')
  const vertices = [...new Map(panels.flat().map(p => [key(p), p])).values()]
  const edges = new Map<string, { count: number; orientation: number }>()
  let volume = 0
  for (const p of panels) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], d = b.map((v, j) => v - a[j]), length2 = d.reduce((s, v) => s + v * v, 0)
      assert.ok(length2 > 0, 'surface edges must have nonzero length')
      // A slab union can split one side of an edge into several collinear edges.
      const cuts = vertices.flatMap(v => {
        const t = v.reduce((s, n, j) => s + (n - a[j]) * d[j], 0) / length2
        return t >= -1e-10 && t <= 1 + 1e-10 && Math.hypot(...v.map((n, j) => n - a[j] - t * d[j])) < 1e-13 ? [{ t, v }] : []
      }).sort((a, b) => a.t - b.t)
      for (let j = 1; j < cuts.length; j++) {
        const [u, v] = [key(cuts[j - 1].v), key(cuts[j].v)], id = [u, v].sort().join(' '), edge = edges.get(id) ?? { count: 0, orientation: 0 }
        edge.count++; edge.orientation += u < v ? 1 : -1; edges.set(id, edge)
      }
    }
    for (let i = 1; i < p.length - 1; i++) {
      const [a, b, c] = [p[0], p[i], p[i + 1]]
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  assert.ok(edges.size > 0)
  for (const edge of edges.values()) assert.deepEqual(edge, { count: 2, orientation: 0 }, 'each solid edge must have two oppositely wound faces')
  return volume
}

test('ground selection follows reference connectivity and is_ground, independent of net name or proximity', () => {
  const { circuit, modeling } = groundPlaneFixture()
  const net = circuit.find(e => e.type === 'source_net' && e.source_net_id === 'ground')!
  if (net.type !== 'source_net') throw Error('fixture')
  net.name = 'reference-copper'
  const pour = circuit.find(e => e.type === 'pcb_copper_pour')!
  if (pour.type !== 'pcb_copper_pour') throw Error('fixture')
  circuit.push({ ...pour, pcb_copper_pour_id: 'power-plane', source_net_id: 'power' })
  const g = geometryFromCircuitJson(circuit, modeling), copper = g.cells[0].routedCopper!
  assert.equal(copper.sourceNetId, 'ground')
  assert.equal(copper.sourceNetName, 'reference-copper')
  assert.deepEqual(copper.pours.map(p => p.pcbCopperPourId), ['ground-plane'])
  assert.deepEqual(copper.referenceSourcePortIds, ['ground0', 'ground1'])
  assert.deepEqual(copper.pours[0].polygon[1], [[4, .25], [6, .25], [6, -.25], [4, -.25]])
  assert.ok(Math.abs(copper.pours[0].zMaxMm - copper.pours[0].zMinMm - .035) < 1e-12)
})

test('one ground split into same-named per-subcircuit net records is a single ground', () => {
  // Subcircuits scope net records, so a board-wide GND appears once per subcircuit.
  const { circuit, modeling } = groundPlaneFixture()
  const net = circuit.find(e => e.type === 'source_net' && e.source_net_id === 'ground')!
  if (net.type !== 'source_net') throw Error('fixture')
  circuit.push({ ...net, source_net_id: 'ground-other-subcircuit', subcircuit_id: 'other' },
    { type: 'source_trace', source_trace_id: 'tie', connected_source_port_ids: ['ground1'], connected_source_net_ids: ['ground-other-subcircuit'] })
  const copper = geometryFromCircuitJson(circuit, modeling).cells[0].routedCopper!
  assert.equal(copper.sourceNetId, 'ground', 'named after the reference pin\'s own ground record')
  assert.deepEqual(copper.pours.map(p => p.pcbCopperPourId), ['ground-plane'])
})

test('signal route endpoints must reach the physical source and receiver pad layers', () => {
  for (const id of ['b0', 'b2']) {
    const { circuit, modeling } = groundPlaneFixture()
    const port = circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === id)!
    if (port.type !== 'pcb_port') throw Error('fixture')
    port.layers = ['bottom']
    assert.throws(() => geometryFromCircuitJson(circuit, modeling), /endpoint_layer/)
  }
})

test('missing/ambiguous ground, missing geometry and disconnected references never fall back to a strip', () => {
  for (const kind of ['flag', 'ambiguous', 'pour', 'return'] as const) {
    const { circuit, modeling } = groundPlaneFixture()
    if (kind === 'flag') { const net = circuit.find(e=>e.type==='source_net'&&e.source_net_id==='ground')!; if(net.type==='source_net') net.is_ground=false }
    if (kind === 'ambiguous') circuit.push({ type:'source_net',source_net_id:'other',name:'OTHER',is_ground:true,member_source_group_ids:[] }, { type:'source_trace',source_trace_id:'short',connected_source_port_ids:['ground0'],connected_source_net_ids:['other'] })
    if (kind === 'pour') circuit.splice(circuit.findIndex(e=>e.type==='pcb_copper_pour'),1)
    if (kind === 'return') { const trace=circuit.find(e=>e.type==='source_trace'&&e.source_trace_id==='ground-trace1')!; if(trace.type==='source_trace') trace.connected_source_net_ids=[] }
    assert.throws(()=>geometryFromCircuitJson(circuit,modeling),/ground_(net|geometry|reference)/)
  }
})

test('receiver ground is inferred from IBIS references and conflicting or missing bindings fail', () => {
  const { circuit, modeling } = groundPlaneFixture()
  delete modeling.groundReturn
  assert.deepEqual(geometryFromCircuitJson(circuit, modeling).cells[0].routedCopper!.referenceSourcePortIds, ['ground0', 'ground1'])
  const model = circuit.find(e => e.type === 'simulation_ibis_model')!
  if (model.type !== 'simulation_ibis_model') throw Error('fixture')
  model.ibis_pin_name_to_reference_source_port_ids!['4'].ground_clamp_reference_source_port_id = 'ground0'
  assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_reference/)
  delete model.ibis_pin_name_to_reference_source_port_ids
  assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_reference/)
})

test('physical ground contacts require copper pads and cannot be placed in a cutout', () => {
  for (const kind of ['missing-pad', 'cutout'] as const) {
    const { circuit, modeling } = groundPlaneFixture()
    if (kind === 'missing-pad') circuit.splice(circuit.findIndex(e => e.type === 'pcb_smtpad'), 1)
    else {
      const port = circuit.find(e => e.type === 'pcb_port' && e.source_port_id === 'ground1')!
      if (port.type !== 'pcb_port') throw Error('fixture')
      port.x = 5; port.y = 0
    }
    assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_connection/)
  }
})

test('ground routes preserve the physical pad layer and reject misplaced vias or a via endpoint', () => {
  const valid = routedGroundPlaneFixture(), connection = geometryFromCircuitJson(valid.circuit, valid.modeling).cells[0].routedCopper!.connections[0]
  assert.deepEqual(connection.terminals, [[0, -1, .2175], [1, -1, -.0175]])
  assert.equal(connection.contactRadiusMm, .1)
  for (const kind of ['wrong-layer', 'misplaced-via', 'via-endpoint'] as const) {
    const { circuit, modeling, lead } = routedGroundPlaneFixture()
    if (kind === 'wrong-layer') for (const point of lead.route) { if (point.route_type === 'wire') point.layer = 'bottom' }
    else {
      lead.route.push({ route_type: 'via', x: kind === 'misplaced-via' ? 2 : 1, y: -1, from_layer: 'top', to_layer: 'bottom', hole_diameter: .1 })
      if (kind === 'misplaced-via') lead.route.push({ route_type: 'wire', x: 2, y: -1, layer: 'bottom', width: .1 })
    }
    assert.throws(() => geometryFromCircuitJson(circuit, modeling), kind === 'misplaced-via' ? /via_geometry/ : /ground_connection/)
  }
})

test('FasterCap reference lead and via union forms a closed outward-facing solid', () => {
  const { circuit, modeling } = routedGroundPlaneFixture(), cell = geometryFromCircuitJson(circuit, modeling).cells[0]
  const files = fasterCapDeck(cell, modeling.extraction)
  for (const name of ['sig0', 'sig1', 'return']) assert.ok(closedSurfaceVolume(files[`${name}.txt`]) > 0)
  assert.ok(closedSurfaceVolume(files['return.txt']) > 47 * .035 * 1e-9, 'ground lead and via add copper to the physical plane')
})

test('bent routes and ground polygon coordinates remain physical and input records stay unchanged', () => {
  const { circuit, modeling } = groundPlaneFixture()
  const trace = circuit.find(e => e.type === 'pcb_trace' && e.pcb_trace_id === 't0')!
  if (trace.type !== 'pcb_trace') throw Error('fixture')
  trace.route.splice(1, 0, { route_type: 'wire', x: 4, y: -1.375, width: .1, layer: 'top' })
  const before = structuredClone(circuit), g = geometryFromCircuitJson(circuit, modeling), copper = g.cells[0].routedCopper!
  assert.deepEqual(circuit, before)
  assert.deepEqual(copper.signals[0].segments.map(s => [s.a, s.b]), [
    [[0, -.375, .2175], [4, -1.375, .2175]], [[4, -1.375, .2175], [10, -.375, .2175]],
  ])
  assert.deepEqual(copper.pours[0].polygon[0], [[-1, -2], [11, -2], [11, 2], [-1, 2]])
  assert.match(fastHenryDeck(g.cells[0], modeling.extraction), /x=0\.004 y=-0\.001375 z=0\.0002175/)
})

test('adaptive ground mesh preserves the cutout and resolves connected finite contact areas', () => {
  const { circuit, modeling } = groundPlaneFixture(), copper = geometryFromCircuitJson(circuit, modeling).cells[0].routedCopper!
  const contacts = copper.connections.map(p => ({ point: [p.terminals[1][0], p.terminals[1][1]] as [number, number], radius: p.contactRadiusMm! }))
  const mesh = groundMesh(copper.pours[0], modeling.extraction.groundMeshMm!, contacts)
  const parents = mesh.points.map((_, i) => i), root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]))
  for (const [a, b, width] of mesh.edges) {
    assert.ok(Number.isFinite(width) && width > 0)
    parents[root(a)] = root(b)
    for (const t of [0, .25, .5, .75, 1]) {
      const x = mesh.points[a][0] * (1 - t) + mesh.points[b][0] * t, y = mesh.points[a][1] * (1 - t) + mesh.points[b][1] * t
      assert.ok(x >= -1 && x <= 11 && y >= -2 && y <= 2)
      assert.ok(!(x > 4 && x < 6 && y > -.25 && y < .25), 'mesh must not bridge a copper cutout')
    }
  }
  for (const [i, group] of mesh.contacts.entries()) {
    assert.ok(group.length >= 4, 'reference contact must resolve a finite area')
    for (const id of group) {
      assert.equal(root(id), root(mesh.contacts[0][0]))
      assert.ok(Math.hypot(mesh.points[id][0] - contacts[i].point[0], mesh.points[id][1] - contacts[i].point[1]) <= contacts[i].radius)
    }
  }
  assert.throws(() => groundMesh(copper.pours[0], .5, [{ point: [5, 0], radius: .1 }]), /ground_mesh/)
})

test('both native decks use ground polygon cutouts and original trace coordinates', () => {
  const { circuit, modeling } = groundPlaneFixture(), cell = geometryFromCircuitJson(circuit, modeling).cells[0]
  const fh = fastHenryDeck(cell, modeling.extraction), fc = fasterCapDeck(cell, modeling.extraction)
  assert.match(fh,/ground-plane layer=bottom cutouts=1/)
  assert.match(fh,/Eg0_0 /)
  assert.match(fh,/Np0_\d+ x=-0.001 y=-0.002/)
  assert.match(fh,/N0a x=0 y=-0.000375/)
  assert.match(fh,/\.external N2a N2b/)
  assert.match(fc['return.txt'],/T return/)
  assert.match(fc['return.txt'],/Q return/)
  assert.match(fc['channel.lst'].split('\n')[0], /\bmillimetres\b/)
  // Divergence theorem independently verifies the closed, outward-facing solid
  // volume: (12*4 - 2*.5) * .035 mm^3, including the hole side walls.
  const volume = closedSurfaceVolume(fc['return.txt'])
  assert.ok(Math.abs(volume-47*.035*1e-9)<1e-20)
  assert.ok(fh.length < fastHenryDeck(cell,{...modeling.extraction,groundMeshMm:.25}).length)
})


test('FasterCap copper panels are pre-shaped: graded faces, short side walls, same closed solid (#28)', () => {
  const { circuit, modeling } = groundPlaneFixture(), cell = geometryFromCircuitJson(circuit, modeling).cells[0]
  const panels = (surface: string) => surface.split('\n').filter(r => /^[TQ] /.test(r)).map(row => {
    const values = row.split(' ').slice(2).map(Number)
    return { kind: row[0], points: Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3)) }
  })
  const edges = (points: number[][]) => points.map((p, i) => Math.hypot(...p.map((v, j) => v - points[(i + 1) % points.length][j])))
  const legacy = copperFasterCapDeck(cell), shaped = fasterCapDeck(cell, modeling.extraction)
  for (const name of ['sig0', 'sig1', 'return']) {
    const before = panels(legacy[`${name}.txt`]), after = panels(shaped[`${name}.txt`])
    assert.ok(after.length > before.length, `${name} is subdivided`)
    // Subdivision keeps the exact closed, outward-facing copper solid.
    assert.ok(Math.abs(closedSurfaceVolume(shaped[`${name}.txt`]) - closedSurfaceVolume(legacy[`${name}.txt`])) < 1e-20)
    for (const { kind, points } of after) {
      const e = edges(points)
      assert.ok(Math.min(...e) > 0)
      if (kind === 'T') assert.ok(Math.max(...e) <= modeling.extraction.maxPanelLengthMm, 'face panels respect maxPanelLengthMm')
      else assert.ok(Math.max(e[0], e[2]) <= panelAspectLimit * Math.min(e[1], e[3]) * (1 + 1e-9), 'side walls are not thin slivers')
    }
  }
  // Pour faces are graded: fine panels under the trace (y = -.375 / .375), coarse far away.
  const pourFace = panels(shaped['return.txt']).filter(p => p.kind === 'T' && p.points.every(q => q[2] === p.points[0][2]))
  const size = (near: boolean) => {
    const chosen = pourFace.filter(p => { const y = p.points.reduce((s, q) => s + q[1], 0) / 3; return near ? Math.abs(Math.abs(y) - .375) < .1 : Math.abs(y) > 1.5 })
    return chosen.reduce((s, p) => s + Math.max(...edges(p.points)), 0) / chosen.length
  }
  assert.ok(size(true) < .25 && size(false) > 2 * size(true), 'pour panels grade from fine near the signal to coarse far away')
})

test('a copper ring that touches its own edge meshes without losing area', () => {
  // AM3352 ground pour island: a via-clearance arc whose apex (vertex 6) lies
  // exactly on the island's outer edge 16-17, so that edge is split before grading.
  const ring: [number, number][] = [[-1.549946, -25.066683688113], [-1.613867112882, -25.048153938437], [-1.61365003549, -25.047405097858], [-1.619080171618, -25.046324976626], [-1.635301339059, -25.035486339059], [-1.646139976626, -25.019265171618], [-1.649946, -25.000131], [-1.646139976626, -24.980996828382], [-1.635301339059, -24.964775660941], [-1.619080171618, -24.953937023374], [-1.599946, -24.950131], [-1.586241964509, -24.952856902141], [-1.586024887118, -24.952108061563], [-1.442037630218, -24.993847757677], [-1.549946, -24.962566777263], [-1.549946, -24.931408660703], [-1.649946, -24.931408660703], [-1.649946, -25.068853339297], [-1.549946, -25.068853339297]]
  const shoelace = Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
  for (const h of [.2, .02, .005]) {
    const triangles = meshPolygon([ring], () => h)
    const area = triangles.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0)
    assert.ok(Math.abs(area - shoelace) < 1e-9 * Math.max(1, shoelace), `h=${h}: ${area} vs ${shoelace}`)
  }
})

test('finely sampled curved traces coalesce sub-width segments and avoid FastHenry mutualfil infinity (#46)', () => {
  // AM3352 DDR_DQSn0 curve on inner2 (z = 0.7854 mm, w = 100 um, h = 15.2 um) around (3.18, -18.55) mm.
  const curvePoints: [number, number][] = [
    [3.2990729193592396, -18.454142554843102], [3.290962011959365, -18.46473288751245],
    [3.2828528527377547, -18.47532481076991], [3.274745133442638, -18.485918328275385],
    [3.2666385456706584, -18.496513443280723], [3.2585327808887583, -18.507110158649045],
    [3.2504275304700556, -18.51770847685607], [3.2423224857552886, -18.528308399958245],
    [3.234217338094414, -18.538909929587014], [3.2261117787998272, -18.549513067058893],
    [3.2180054991922717, -18.56011781336461], [3.209898404444843, -18.57072388945778],
    [3.2017903742538905, -18.581331049420154], [3.1936806987595947, -18.591939818516234],
    [3.1855690699392887, -18.602550196205158], [3.1774551800263415, -18.613162181544638],
    [3.1693387215480726, -18.623775773191536], [3.1612193873637726, -18.634390969402467],
    [3.15309687070284, -18.645007768034436], [3.144970865202632, -18.655626166545986],
    [3.1368410649464487, -18.6662461619983], [3.128707164501557, -18.676867751056438],
    [3.1205688589569864, -18.687490929990975], [3.112425843961388, -18.69811569467967],
    [3.104277815760943, -18.708742040609227],
  ]
  const outerFil = (a: [number, number], b: [number, number], offW: number, zM: number) => {
    const x0 = a[0] * 1e-3, y0 = a[1] * 1e-3, x1 = b[0] * 1e-3, y1 = b[1] * 1e-3
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), wx = -dy / len, wy = dx / len
    return { x0: x0 + offW * wx, y0: y0 + offW * wy, z0: zM, x1: x1 + offW * wx, y1: y1 + offW * wy, z1: zM, len }
  }
  const hasAtanhSingularity = (f1: ReturnType<typeof outerFil>, f2: ReturnType<typeof outerFil>) => {
    const R1 = Math.hypot(f1.x1 - f2.x1, f1.y1 - f2.y1, f1.z1 - f2.z1)
    const R2 = Math.hypot(f1.x1 - f2.x0, f1.y1 - f2.y0, f1.z1 - f2.z0)
    const R3 = Math.hypot(f1.x0 - f2.x0, f1.y0 - f2.y0, f1.z0 - f2.z0)
    const R4 = Math.hypot(f1.x0 - f2.x1, f1.y0 - f2.y1, f1.z0 - f2.z1)
    if (R1 < 1e-13 || R2 < 1e-13 || R3 < 1e-13 || R4 < 1e-13) return false
    return !Number.isFinite(Math.atanh(f1.len / (R1 + R4))) || !Number.isFinite(Math.atanh(f1.len / (R2 + R3))) ||
           !Number.isFinite(Math.atanh(f2.len / (R1 + R2))) || !Number.isFinite(Math.atanh(f2.len / (R3 + R4)))
  }
  // Uncoalesced consecutive 13.3 um segments at index 10-12 reproduce the exact FastHenry #46 failure.
  const rawFil1 = outerFil(curvePoints[10], curvePoints[11], -0.375 * 1e-4, 0.0007911)
  const rawFil2 = outerFil(curvePoints[11], curvePoints[12], -0.375 * 1e-4, 0.0007911)
  assert.ok(Math.abs(rawFil1.x0 - 0.00318821) < 1e-7 && Math.abs(rawFil1.y0 - -0.0185373) < 1e-6)
  assert.ok(hasAtanhSingularity(rawFil1, rawFil2), 'raw sub-width curve segments trigger FastHenry atanh(1) = Infinity')

  const { circuit, modeling } = groundPlaneFixture()
  const trace = circuit.find(e => e.type === 'pcb_trace' && e.pcb_trace_id === 't0')!
  if (trace.type !== 'pcb_trace') throw Error('fixture')
  const fullRoutePoints: [number, number][] = [[0, -.375], ...curvePoints, [10, -.375]]
  trace.route.splice(1, 0, ...curvePoints.map(([x, y]) => ({ route_type: 'wire' as const, x, y, width: .1, layer: 'top' as const })))

  const cell = geometryFromCircuitJson(circuit, modeling).cells[0], sig = cell.routedCopper!.signals[0]
  assert.ok(sig.segments.length < fullRoutePoints.length - 1 && sig.segments.length >= 4)
  for (const s of sig.segments) assert.ok(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) >= s.widthMm - 1e-9, 'no segment in coalesced curve is shorter than trace width')
  assert.deepEqual(sig.terminals[0].slice(0, 2), [0, -.375])
  assert.deepEqual(sig.terminals[1].slice(0, 2), [10, -.375])

  for (let i = 0; i < sig.segments.length; i++) {
    for (let j = i + 1; j < sig.segments.length; j++) {
      for (const off1 of [-0.375e-4, 0, 0.375e-4]) {
        for (const off2 of [-0.375e-4, 0, 0.375e-4]) {
          const f1 = outerFil([sig.segments[i].a[0], sig.segments[i].a[1]], [sig.segments[i].b[0], sig.segments[i].b[1]], off1, 0.0007911)
          const f2 = outerFil([sig.segments[j].a[0], sig.segments[j].a[1]], [sig.segments[j].b[0], sig.segments[j].b[1]], off2, 0.0007911)
          assert.ok(!hasAtanhSingularity(f1, f2), `coalesced segments ${i},${j} must not trigger FastHenry mutualfil infinity`)
        }
      }
    }
  }

  const rawLen = fullRoutePoints.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - fullRoutePoints[i][0], p[1] - fullRoutePoints[i][1]), 0)
  const coalescedLen = sig.segments.reduce((sum, s) => sum + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0)
  assert.ok(Math.abs(coalescedLen - rawLen) / rawLen < 0.01, 'coalesced DC resistance R is within <1% of uncoalesced trace')
  const singleFilInductance = (pts: [number, number][]) => {
    const W = 1e-4, T = 1.52e-5, segs = pts.slice(1).map((b, i) => outerFil(pts[i], b, 0, 0.0007854))
    let total = 0
    for (let i = 0; i < segs.length; i++) {
      const f1 = segs[i], L = f1.len, w = W / L, t = T / L, r = Math.hypot(w, t), aw = Math.hypot(w, 1), at = Math.hypot(t, 1), ar = Math.hypot(r, 1)
      let z = 0.25 * ((1 / w) * Math.asinh(w / at) + (1 / t) * Math.asinh(t / aw) + Math.asinh(1 / r))
      z += (1 / 24) * ((t * t / w) * Math.asinh(w / (t * at * (r + ar))) + (w * w / t) * Math.asinh(t / (w * aw * (r + ar))) +
        (t * t / (w * w)) * Math.asinh(w * w / (t * r * (at + ar))) + (w * w / (t * t)) * Math.asinh(t * t / (w * r * (aw + ar))) +
        (1 / (w * t * t)) * Math.asinh(w * t * t / (at * (aw + ar))) + (1 / (t * w * w)) * Math.asinh(t * w * w / (aw * (at + ar))))
      z -= (1 / 6) * ((1 / (w * t)) * Math.atan(w * t / ar) + (t / w) * Math.atan(w / (t * ar)) + (w / t) * Math.atan(t / (w * ar)))
      z -= (1 / 60) * (((ar + r + t + at) * t * t) / ((ar + r) * (r + t) * (t + at) * (at + ar)) +
        ((ar + r + w + aw) * w * w) / ((ar + r) * (r + w) * (w + aw) * (aw + ar)) + (ar + aw + 1 + at) / ((ar + aw) * (aw + 1) * (1 + at) * (at + ar)))
      z -= (1 / 20) * (1 / (r + ar) + 1 / (aw + ar) + 1 / (at + ar))
      total += 4 * Math.PI * 1e-7 * (2 / Math.PI) * L * z
      for (let j = i + 1; j < segs.length; j++) {
        const f2 = segs[j], l = f1.len, m = f2.len
        const R1 = Math.hypot(f1.x1 - f2.x1, f1.y1 - f2.y1), R2 = Math.hypot(f1.x1 - f2.x0, f1.y1 - f2.y0)
        const R3 = Math.hypot(f1.x0 - f2.x0, f1.y0 - f2.y0), R4 = Math.hypot(f1.x0 - f2.x1, f1.y0 - f2.y1)
        const cos = ((f1.x1 - f1.x0) * (f2.x1 - f2.x0) + (f1.y1 - f1.y0) * (f2.y1 - f2.y0)) / (l * m)
        const M = R2 < 1e-13
          ? 2e-7 * cos * (l * Math.atanh(m / (l + R4)) + m * Math.atanh(l / (m + R4)))
          : (() => {
              const alpha = R4 * R4 - R3 * R3 + R2 * R2 - R1 * R1, denom = 4 * l * l * m * m - alpha * alpha
              const u = l * (2 * m * m * (R2 * R2 - R3 * R3 - l * l) + alpha * (R4 * R4 - R3 * R3 - m * m)) / denom
              const v = m * (2 * l * l * (R4 * R4 - R3 * R3 - m * m) + alpha * (R2 * R2 - R3 * R3 - l * l)) / denom
              return 2e-7 * cos * ((u + l) * Math.atanh(m / (R1 + R2)) + (v + m) * Math.atanh(l / (R1 + R4)) - u * Math.atanh(m / (R3 + R4)) - v * Math.atanh(l / (R2 + R3)))
            })()
        total += 2 * M
      }
    }
    return total
  }
  const rawL = singleFilInductance(fullRoutePoints)
  const coalescedPts: [number, number][] = [[sig.segments[0].a[0], sig.segments[0].a[1]], ...sig.segments.map(s => [s.b[0], s.b[1]] as [number, number])]
  const coalescedL = singleFilInductance(coalescedPts)
  assert.ok(Math.abs(coalescedL - rawL) / rawL < 0.01, `coalesced inductance L (${coalescedL}) is within <1% of nwinc=1 nhinc=1 uncoalesced reference (${rawL})`)
  assert.match(fastHenryDeck(cell, modeling.extraction), /E\d+ N0a Nt0/)
})
