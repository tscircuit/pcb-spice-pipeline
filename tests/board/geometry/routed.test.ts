import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, parseRecord, type CircuitJson } from '../../../src/board'
import { fastHenryDeck, fasterCapDeck } from '../../../src/extraction'
import { groundPlaneFixture, routedGroundPlaneFixture } from '../../fixtures/ground-plane'
import { modeling as nativeModeling } from '../../fixtures/native-channel'
import { viaInPad } from '../../fixtures/via-in-pad'

test('ground selection follows reference connectivity and is_ground, independent of net name or proximity', () => {
  const { circuit, modeling } = groundPlaneFixture()
  const net = circuit.find(e => e.type === 'source_net' && e.source_net_id === 'ground')!
  if (net.type !== 'source_net') throw Error('fixture')
  net.name = 'reference-copper'
  const pour = circuit.find(e => e.type === 'pcb_copper_pour')!
  if (pour.type !== 'pcb_copper_pour') throw Error('fixture')
  circuit.push({ ...pour, pcb_copper_pour_id: 'power-plane', source_net_id: 'power' })
  const g = geometryFromCircuitJson(circuit, modeling)
  const copper = g.cells[0].routedCopper!
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
    if (kind === 'flag') {
      const net = circuit.find(e=>e.type==='source_net'&&e.source_net_id==='ground')!
      if(net.type==='source_net') net.is_ground=false
    }
    if (kind === 'ambiguous') circuit.push({ type:'source_net',source_net_id:'other',name:'OTHER',is_ground:true,member_source_group_ids:[] }, { type:'source_trace',source_trace_id:'short',connected_source_port_ids:['ground0'],connected_source_net_ids:['other'] })
    if (kind === 'pour') circuit.splice(circuit.findIndex(e=>e.type==='pcb_copper_pour'),1)
    if (kind === 'return') {
      const trace=circuit.find(e=>e.type==='source_trace'&&e.source_trace_id==='ground-trace1')!
      if(trace.type==='source_trace') trace.connected_source_net_ids=[]
    }
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
      port.x = 5
      port.y = 0
    }
    assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_connection/)
  }
})

test('ground routes preserve the physical pad layer and reject misplaced vias or a via endpoint', () => {
  const valid = routedGroundPlaneFixture()
  const connection = geometryFromCircuitJson(valid.circuit, valid.modeling).cells[0].routedCopper!.connections[0]
  assert.deepEqual(connection.terminals, [[0, -1, .2175], [1, -1, -.0175]])
  assert.equal(connection.contactRadiusMm, .1)
  for (const kind of ['wrong-layer', 'misplaced-via', 'via-endpoint'] as const) {
    const { circuit, modeling, lead } = routedGroundPlaneFixture()
    if (kind === 'wrong-layer') for (const point of lead.route) {
      if (point.route_type === 'wire') point.layer = 'bottom'
    } else {
      lead.route.push({ route_type: 'via', x: kind === 'misplaced-via' ? 2 : 1, y: -1, from_layer: 'top', to_layer: 'bottom', hole_diameter: .1 })
      if (kind === 'misplaced-via') lead.route.push({ route_type: 'wire', x: 2, y: -1, layer: 'bottom', width: .1 })
    }
    assert.throws(() => geometryFromCircuitJson(circuit, modeling), kind === 'misplaced-via' ? /via_geometry/ : /ground_connection/)
  }
})

test('bent routes and ground polygon coordinates remain physical and input records stay unchanged', () => {
  const { circuit, modeling } = groundPlaneFixture()
  const trace = circuit.find(e => e.type === 'pcb_trace' && e.pcb_trace_id === 't0')!
  if (trace.type !== 'pcb_trace') throw Error('fixture')
  trace.route.splice(1, 0, { route_type: 'wire', x: 4, y: -1.375, width: .1, layer: 'top' })
  const before = structuredClone(circuit)
  const g = geometryFromCircuitJson(circuit, modeling)
  const copper = g.cells[0].routedCopper!
  assert.deepEqual(circuit, before)
  assert.deepEqual(copper.signals[0].segments.map(s => [s.a, s.b]), [
    [[0, -.375, .2175], [4, -1.375, .2175]], [[4, -1.375, .2175], [10, -.375, .2175]],
  ])
  assert.deepEqual(copper.pours[0].polygon[0], [[-1, -2], [11, -2], [11, 2], [-1, 2]])
  assert.match(fastHenryDeck(g.cells[0], modeling.extraction), /x=0\.004 y=-0\.001375 z=0\.0002175/)
})

// Native via-in-pad reference contacts (was via-in-pad.test.ts).
test('native via-in-pad references reach the inner ground plane', async () => {
  const circuit = await viaInPad()
  assert.deepEqual(circuit.filter(e => e.type.endsWith('_error')), [])
  for (const record of circuit.filter(e => ['pcb_smtpad', 'pcb_via', 'pcb_copper_pour'].includes(e.type))) parseRecord(record)
  const cell = geometryFromCircuitJson(circuit, nativeModeling).cells[0]
  const copper = cell.routedCopper!
  assert.match(fastHenryDeck(cell, nativeModeling.extraction), /\.external/)
  assert.ok(fasterCapDeck(cell, nativeModeling.extraction)['return.txt'].includes('return'))
  assert.equal(copper.connections.length, 2)
  for (const path of copper.connections) {
    assert.equal(path.segments.length, 1)
    assert.notEqual(path.terminals[0][2], path.terminals[1][2])
    assert.equal(path.contactRadiusMm, .15)
  }
})

test('an offset barrel fully within the pad produces a physical pad connection', async () => {
  const circuit = await viaInPad({ offset: .04 })
  const connections = geometryFromCircuitJson(circuit, nativeModeling).cells[0].routedCopper!.connections
  for (const path of connections) {
    assert.equal(path.segments.length, 2)
    assert.ok(Math.abs(path.segments[0].b[0] - path.segments[0].a[0] - .04) < 1e-9)
  }
})

test('direct contacts reject disconnected, wrong-net, out-of-span, missing and ambiguous vias', async () => {
  for (const options of [
    { offset: .4 }, { viaNet: 'other' as const }, { viaEnd: 'inner1' as const, planeLayer: 'inner2' as const },
    { planeMiss: true }, { planeEdge: -3.25 }, { duplicate: true },
  ]) {
    const circuit = await viaInPad(options)
    assert.throws(() => geometryFromCircuitJson(circuit, nativeModeling), /ground_(connection|geometry)/, JSON.stringify(options))
  }
})

test('direct contacts validate barrel plating and omitted stubs', async () => {
  const circuit = await viaInPad()
  assert.throws(() => geometryFromCircuitJson(circuit, { ...nativeModeling, viaPlatingMm: .08 }), /via_geometry/)
  assert.throws(() => geometryFromCircuitJson(circuit, { ...nativeModeling, omitThroughViaStubs: false }), /via_stub/)
})

// Explicitly conflicting metadata is difficult to express as valid native TSX.
test('a native via with conflicting electrical metadata is not accepted', async () => {
  const circuit = await viaInPad()
  const via = circuit.find(e => e.type === 'pcb_via')!
  const signal = circuit.find(e => e.type === 'source_net' && e.name === 'DQ')!
  if (via.type !== 'pcb_via' || signal.type !== 'source_net') throw Error('fixture')
  via.source_net_id = signal.source_net_id
  parseRecord(via)
  assert.throws(() => geometryFromCircuitJson(circuit, nativeModeling), /ground_connection/)
})

test('a via with conflicting declared span cannot reach the pour', async () => {
  const circuit = await viaInPad()
  const via = circuit.find(e => e.type === 'pcb_via')!
  if (via.type !== 'pcb_via') throw Error('fixture')
  via.to_layer = 'inner2'
  parseRecord(via)
  assert.throws(() => geometryFromCircuitJson(circuit, nativeModeling), /ground_connection/)
})

test('a via center inside the pour is insufficient when the barrel crosses its edge', async () => {
  const circuit = await viaInPad({ planeEdge: -3.25 })
  const pour = circuit.find(e => e.type === 'pcb_copper_pour')!
  if (pour.type !== 'pcb_copper_pour' || pour.shape !== 'brep') throw Error('fixture')
  assert.ok(Math.abs(Math.min(...pour.brep_shape.outer_ring.vertices.map(p => p.x)) + 3.05) < 1e-9)
  assert.throws(() => geometryFromCircuitJson(circuit, nativeModeling), /ground_connection/)
})

test('a board-level via in the pad of a part inside a nested subcircuit is a direct contact', async () => {
  // Move both parts' pads into a child subcircuit of the board, as boards built
  // from subcircuits save them; the vias stay board-level.
  /** A via-in-pad board with either the pads or the vias moved into a child subcircuit. */
  const nest = async (scope: 'pads' | 'vias'): Promise<CircuitJson> => {
    const circuit = await viaInPad()
    const board = circuit.find(e => e.type === 'source_group' && e.is_subcircuit && !e.parent_source_group_id)!
    if (board.type !== 'source_group') throw Error('fixture')
    circuit.push({ type: 'source_group', source_group_id: 'child', name: 'CHILD', is_subcircuit: true, subcircuit_id: 'child_scope', parent_source_group_id: board.source_group_id })
    for (const e of circuit) if ((scope === 'pads' ? e.type === 'pcb_port' : e.type === 'pcb_via') && 'subcircuit_id' in e) e.subcircuit_id = 'child_scope'
    return circuit
  }
  const connections = geometryFromCircuitJson(await nest('pads'), nativeModeling).cells[0].routedCopper!.connections
  for (const path of connections) assert.equal(path.contactRadiusMm, .15)
  // A via owned by a nested subcircuit does not belong to a pad outside it.
  const nestedVias = await nest('vias')
  assert.throws(() => geometryFromCircuitJson(nestedVias, nativeModeling), /ground_connection/)
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
  /** Computes one FastHenry filament endpoint pair in metres at width offset `offsetWidth` and height `zM`. */
  const outerFilament = (a: [number, number], b: [number, number], offsetWidth: number, zM: number): {
    x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; len: number
  } => {
    const x0 = a[0] * 1e-3
    const y0 = a[1] * 1e-3
    const x1 = b[0] * 1e-3
    const y1 = b[1] * 1e-3
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    const wx = -dy / len
    const wy = dx / len
    return { x0: x0 + offsetWidth * wx, y0: y0 + offsetWidth * wy, z0: zM, x1: x1 + offsetWidth * wx, y1: y1 + offsetWidth * wy, z1: zM, len }
  }
  /** True when two filaments trigger the FastHenry `atanh(1) = Infinity` singularity in `mutualfil`. */
  const hasFilamentSingularity = (f1: ReturnType<typeof outerFilament>, f2: ReturnType<typeof outerFilament>): boolean => {
    const R1 = Math.hypot(f1.x1 - f2.x1, f1.y1 - f2.y1, f1.z1 - f2.z1)
    const R2 = Math.hypot(f1.x1 - f2.x0, f1.y1 - f2.y0, f1.z1 - f2.z0)
    const R3 = Math.hypot(f1.x0 - f2.x0, f1.y0 - f2.y0, f1.z0 - f2.z0)
    const R4 = Math.hypot(f1.x0 - f2.x1, f1.y0 - f2.y1, f1.z0 - f2.z1)
    if (R1 < 1e-13 || R2 < 1e-13 || R3 < 1e-13 || R4 < 1e-13) return false
    return !Number.isFinite(Math.atanh(f1.len / (R1 + R4))) || !Number.isFinite(Math.atanh(f1.len / (R2 + R3))) ||
           !Number.isFinite(Math.atanh(f2.len / (R1 + R2))) || !Number.isFinite(Math.atanh(f2.len / (R3 + R4)))
  }
  // Uncoalesced consecutive 13.3 um segments at index 10-12 reproduce the exact FastHenry #46 failure.
  const rawFilament1 = outerFilament(curvePoints[10], curvePoints[11], -0.375 * 1e-4, 0.0007911)
  const rawFilament2 = outerFilament(curvePoints[11], curvePoints[12], -0.375 * 1e-4, 0.0007911)
  assert.ok(Math.abs(rawFilament1.x0 - 0.00318821) < 1e-7 && Math.abs(rawFilament1.y0 - -0.0185373) < 1e-6)
  assert.ok(hasFilamentSingularity(rawFilament1, rawFilament2), 'raw sub-width curve segments trigger FastHenry atanh(1) = Infinity')

  const { circuit, modeling } = groundPlaneFixture()
  const trace = circuit.find(e => e.type === 'pcb_trace' && e.pcb_trace_id === 't0')!
  if (trace.type !== 'pcb_trace') throw Error('fixture')
  const fullRoutePoints: [number, number][] = [[0, -.375], ...curvePoints, [10, -.375]]
  trace.route.splice(1, 0, ...curvePoints.map(([x, y]) => ({ route_type: 'wire' as const, x, y, width: .1, layer: 'top' as const })))

  const cell = geometryFromCircuitJson(circuit, modeling).cells[0]
  const sig = cell.routedCopper!.signals[0]
  assert.ok(sig.segments.length < fullRoutePoints.length - 1 && sig.segments.length >= 4)
  for (const s of sig.segments) assert.ok(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) >= s.widthMm - 1e-9, 'no segment in coalesced curve is shorter than trace width')
  assert.deepEqual(sig.terminals[0].slice(0, 2), [0, -.375])
  assert.deepEqual(sig.terminals[1].slice(0, 2), [10, -.375])

  for (let i = 0; i < sig.segments.length; i++) {
    for (let j = i + 1; j < sig.segments.length; j++) {
      for (const off1 of [-0.375e-4, 0, 0.375e-4]) {
        for (const off2 of [-0.375e-4, 0, 0.375e-4]) {
          const f1 = outerFilament([sig.segments[i].a[0], sig.segments[i].a[1]], [sig.segments[i].b[0], sig.segments[i].b[1]], off1, 0.0007911)
          const f2 = outerFilament([sig.segments[j].a[0], sig.segments[j].a[1]], [sig.segments[j].b[0], sig.segments[j].b[1]], off2, 0.0007911)
          assert.ok(!hasFilamentSingularity(f1, f2), `coalesced segments ${i},${j} must not trigger FastHenry mutualfil infinity`)
        }
      }
    }
  }

  const rawLength = fullRoutePoints.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - fullRoutePoints[i][0], p[1] - fullRoutePoints[i][1]), 0)
  const mergedLength = sig.segments.reduce((sum, s) => sum + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0)
  assert.ok(Math.abs(mergedLength - rawLength) / rawLength < 0.01, 'coalesced DC resistance R is within <1% of uncoalesced trace')
  /** Analytical single-filament (`nwinc=1 nhinc=1`) loop inductance for a polyline of points in mm. */
  const singleFilamentInductance = (points: [number, number][]): number => {
    const W = 1e-4
    const T = 1.52e-5
    const segments = points.slice(1).map((b, i) => outerFilament(points[i], b, 0, 0.0007854))
    let total = 0
    for (let i = 0; i < segments.length; i++) {
      const f1 = segments[i]
      const L = f1.len
      const w = W / L
      const t = T / L
      const r = Math.hypot(w, t)
      const aw = Math.hypot(w, 1)
      const at = Math.hypot(t, 1)
      const ar = Math.hypot(r, 1)
      let z = 0.25 * ((1 / w) * Math.asinh(w / at) + (1 / t) * Math.asinh(t / aw) + Math.asinh(1 / r))
      z += (1 / 24) * ((t * t / w) * Math.asinh(w / (t * at * (r + ar))) + (w * w / t) * Math.asinh(t / (w * aw * (r + ar))) +
        (t * t / (w * w)) * Math.asinh(w * w / (t * r * (at + ar))) + (w * w / (t * t)) * Math.asinh(t * t / (w * r * (aw + ar))) +
        (1 / (w * t * t)) * Math.asinh(w * t * t / (at * (aw + ar))) + (1 / (t * w * w)) * Math.asinh(t * w * w / (aw * (at + ar))))
      z -= (1 / 6) * ((1 / (w * t)) * Math.atan(w * t / ar) + (t / w) * Math.atan(w / (t * ar)) + (w / t) * Math.atan(t / (w * ar)))
      z -= (1 / 60) * (((ar + r + t + at) * t * t) / ((ar + r) * (r + t) * (t + at) * (at + ar)) +
        ((ar + r + w + aw) * w * w) / ((ar + r) * (r + w) * (w + aw) * (aw + ar)) + (ar + aw + 1 + at) / ((ar + aw) * (aw + 1) * (1 + at) * (at + ar)))
      z -= (1 / 20) * (1 / (r + ar) + 1 / (aw + ar) + 1 / (at + ar))
      total += 4 * Math.PI * 1e-7 * (2 / Math.PI) * L * z
      for (let j = i + 1; j < segments.length; j++) {
        const f2 = segments[j]
        const l = f1.len
        const m = f2.len
        const R1 = Math.hypot(f1.x1 - f2.x1, f1.y1 - f2.y1)
        const R2 = Math.hypot(f1.x1 - f2.x0, f1.y1 - f2.y0)
        const R3 = Math.hypot(f1.x0 - f2.x0, f1.y0 - f2.y0)
        const R4 = Math.hypot(f1.x0 - f2.x1, f1.y0 - f2.y1)
        const cos = ((f1.x1 - f1.x0) * (f2.x1 - f2.x0) + (f1.y1 - f1.y0) * (f2.y1 - f2.y0)) / (l * m)
        const M = R2 < 1e-13
          ? 2e-7 * cos * (l * Math.atanh(m / (l + R4)) + m * Math.atanh(l / (m + R4)))
          : (() => {
              const alpha = R4 * R4 - R3 * R3 + R2 * R2 - R1 * R1
              const denom = 4 * l * l * m * m - alpha * alpha
              const u = l * (2 * m * m * (R2 * R2 - R3 * R3 - l * l) + alpha * (R4 * R4 - R3 * R3 - m * m)) / denom
              const v = m * (2 * l * l * (R4 * R4 - R3 * R3 - m * m) + alpha * (R2 * R2 - R3 * R3 - l * l)) / denom
              return 2e-7 * cos * ((u + l) * Math.atanh(m / (R1 + R2)) + (v + m) * Math.atanh(l / (R1 + R4)) - u * Math.atanh(m / (R3 + R4)) - v * Math.atanh(l / (R2 + R3)))
            })()
        total += 2 * M
      }
    }
    return total
  }
  const rawL = singleFilamentInductance(fullRoutePoints)
  const mergedPoints: [number, number][] = [[sig.segments[0].a[0], sig.segments[0].a[1]], ...sig.segments.map(s => [s.b[0], s.b[1]] as [number, number])]
  const coalescedL = singleFilamentInductance(mergedPoints)
  assert.ok(Math.abs(coalescedL - rawL) / rawL < 0.01, `coalesced inductance L (${coalescedL}) is within <1% of nwinc=1 nhinc=1 uncoalesced reference (${rawL})`)
  assert.match(fastHenryDeck(cell, modeling.extraction), /E\d+ N0a Nt0/)
})
