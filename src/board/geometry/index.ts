import type { ArtifactScope, Produced } from '../../kernel'
import { sha256, numerics } from '../../kernel'
import type { CircuitJson } from '../schema'
import type { Board } from '../model'
import { fail } from '../diagnostics'
import { connectedSourceIds } from '../connectivity'
import { stackupFromCircuitJson } from '../stackup'
import { selectPort, resolveRouteVias } from './ports'
import { antipadDiameter } from './antipad'
import { sliceIntervals, wirePolygon, mergeConductors, type CopperShape } from './slices'
import type { BoardModeling, CopperPoint, CrossSection, Geometry, GeometryCell, LaneMapping } from './types'

interface Edge { id: string; lane: string; a: CopperPoint; b: CopperPoint; layer: string; width: number; dx: number; dy: number; lo: number; hi: number; forward: boolean; from: string; to: string }
/** Stable geometry coordinates prevent endpoint roundoff from creating spurious junctions. */
const round = (v: number): number => Math.round(v * 10 ** numerics.coordinateDigits) / 10 ** numerics.coordinateDigits
/** Rejects removed numerical controls even when passed by an untyped JavaScript caller. */
export function validateModeling(modeling: BoardModeling): void {
  for (const key of ['reduction', 'sections', 'extraction', 'profiles', 'straightened_stage_profiles', 'groundMeshMm', 'groundReturn', 'channelReference', 'viaPlatingMm', 'viaEquivalentWidthMm', 'omitThroughViaStubs', 'relativePermittivity'])
    if (key in modeling) fail('modeling_input', `Remove modeling.${key}; physical data comes from pcb_stackup and numerical choices are automatic`)
  if (!modeling.lanes?.length || new Set(modeling.lanes.map(l => l.port)).size !== modeling.lanes.length) fail('lanes', 'Declare distinct lane names and physical endpoints')
}
/** Uses the connected board ground net rather than an API-selected return lead. */
export function boardGround(cj: CircuitJson): { ids: Set<string>; port: string } {
  const nets = cj.filter(r => r.type === 'source_net').filter(r => r.is_ground)
  const negatives = cj.filter(r => r.type === 'simulation_voltage_source').map(r => r.is_dc_source ? r.negative_source_port_id ?? r.negative_source_net_id : r.terminal2_source_port_id).filter((id): id is string => Boolean(id))
  const seed = nets[0]?.source_net_id ?? negatives[0]
  if (!seed) fail('ground_net', 'Mark the ground net or connect a physical DC supply with a negative terminal')
  const ids = connectedSourceIds(cj, seed)
  if (nets.some(n => !ids.has(n.source_net_id))) fail('ground_net', 'Several disconnected ground nets: the channel reference is ambiguous')
  const ports = cj.filter(r => r.type === 'source_port' && ids.has(r.source_port_id))
  if (!ports.length) fail('ground_reference', 'Ground net must connect to a physical source port')
  return { ids, port: ports.map(p => p.type === 'source_port' ? p.source_port_id : '').sort()[0] }
}
/** Walks actual routed wires, cuts at physical events, and intersects every layer with each slice. */
export function geometryFromCircuitJson(cj: CircuitJson, modeling: BoardModeling): Geometry {
  validateModeling(modeling)
  const stackup = stackupFromCircuitJson(cj)
  const ground = boardGround(cj)
  const rails = new Set<string>()
  for (const source of cj.filter(r => r.type === 'simulation_voltage_source')) {
    if (!source.is_dc_source && source.wave_shape) continue
    const positive = source.is_dc_source ? source.positive_source_port_id ?? source.positive_source_net_id : source.terminal1_source_port_id
    if (positive) for (const id of connectedSourceIds(cj, positive)) rails.add(id)
  }
  const board = cj.find(r => r.type === 'pcb_board')!
  if (board.type !== 'pcb_board') fail('stackup', 'Missing pcb_board')
  const outline: CopperPoint[][] = [board.outline?.length ? board.outline.map(p => [p.x, p.y]) : [
    [board.center.x - board.width! / 2, board.center.y - board.height! / 2], [board.center.x + board.width! / 2, board.center.y - board.height! / 2],
    [board.center.x + board.width! / 2, board.center.y + board.height! / 2], [board.center.x - board.width! / 2, board.center.y + board.height! / 2],
  ]]
  const mappings: LaneMapping[] = []
  const edges: Edge[] = []
  const shapes: CopperShape[] = []
  const cells: GeometryCell[] = []
  const laneNets = new Map<string, string>()
  const netForLane = new Map<string, string>()
  const selected = new Set<string>()
  /** Copper layer at the physical height; there is no homogeneous-stackup fallback. */
  const layer = (name: string): Geometry['stackup']['copperLayers'][number] => {
    const found = stackup.copperLayers.find(c => c.name === name)
    if (!found) fail('stackup', `Missing copper layer ${name}`)
    return found
  }
  const endpointsByPosition = new Map<string, string>()
  /** Node at a real route point, shared by adjacent wire segments and vias. */
  const node = (lane: string, x: number, y: number, name: string): string => {
    const key = JSON.stringify([netForLane.get(lane) ?? lane, round(x), round(y), name])
    return endpointsByPosition.get(key) ?? `J${sha256(key).slice(0, 16)}`
  }
  const lanes = [...modeling.lanes]
  for (const trace of cj.filter(r => r.type === 'pcb_trace')) {
    const source = cj.find(r => r.type === 'source_trace' && r.source_trace_id === trace.source_trace_id)
    if (!source || source.type !== 'source_trace' || source.connected_source_port_ids.some(id => ground.ids.has(id) || rails.has(id))) continue
    if (lanes.some(l => l.sourceTraceId === source.source_trace_id || (source.connected_source_port_ids.includes(selectPort(cj, l.from).source_port_id) && source.connected_source_port_ids.includes(selectPort(cj, l.to).source_port_id)))) continue
    if (source.connected_source_port_ids.length !== 2) fail('route_branch', `${source.source_trace_id}: physical branch requires split PCB routes at its junction`)
    lanes.push({ port: `copper_${source.source_trace_id}`, sourceTraceId: source.source_trace_id, from: { sourcePortId: source.connected_source_port_ids[0] }, to: { sourcePortId: source.connected_source_port_ids[1] } })
  }
  for (const lane of lanes.sort((a, b) => a.port.localeCompare(b.port))) {
    const from = selectPort(cj, lane.from)
    const to = selectPort(cj, lane.to)
    const sources = cj.filter(r => r.type === 'source_trace').filter(r => lane.sourceTraceId ? r.source_trace_id === lane.sourceTraceId : r.connected_source_port_ids.includes(from.source_port_id) && r.connected_source_port_ids.includes(to.source_port_id))
    if (sources.length !== 1) fail('route_selection', `${lane.port}: select one complete routed source trace`)
    const source = sources[0]
    if (source.connected_source_port_ids.length !== 2) fail('route_branch', `${lane.port}: routed fanout requires explicit lane endpoints at each junction`)
    const traces = cj.filter(r => r.type === 'pcb_trace' && r.source_trace_id === source.source_trace_id)
    if (traces.length !== 1 || selected.has(source.source_trace_id)) fail('route_selection', `${lane.port}: expected a distinct complete pcb_trace`)
    selected.add(source.source_trace_id)
    const trace = traces[0]
    if (trace.type !== 'pcb_trace') fail('route_selection', lane.port)
    const ports = [from, to].map(p => cj.find(r => r.type === 'pcb_port' && r.source_port_id === p.source_port_id))
    if (ports.some(p => !p || p.type !== 'pcb_port')) fail('pin_mapping', `${lane.port}: missing physical PCB endpoint`)
    let route = resolveRouteVias(cj, trace)
    const p0 = ports[0] as Extract<CircuitJson[number], { type: 'pcb_port' }>
    if (Math.hypot(route[0].x - p0.x, route[0].y - p0.y) > numerics.endpointToleranceMm) route = [...route].reverse().map(p => p.route_type === 'via' ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer } : p)
    const endpoints = [route[0], route.at(-1)!]
    for (let i = 0; i < 2; i++) {
      const p = ports[i] as typeof p0
      if (Math.hypot(endpoints[i].x - p.x, endpoints[i].y - p.y) > numerics.endpointToleranceMm) fail('endpoint_position', `${lane.port}: route misses endpoint ${p.pcb_port_id}`)
    }
    const mapping: LaneMapping = { role: modeling.lanes.some(l => l.port === lane.port) ? 'signal' : 'interconnect', port: lane.port, sourceTraceId: source.source_trace_id, pcbTraceId: trace.pcb_trace_id,
      from: from.source_port_id, to: to.source_port_id, pcbPorts: ports.map(p => p!.type === 'pcb_port' ? p.pcb_port_id : ''), stages: [], originalRoute: route }
    const members = [...connectedSourceIds(cj, from.source_port_id)].sort()
    netForLane.set(lane.port, members[0])
    mappings.push(mapping)
    for (let k = 0; k < endpoints.length; k++) {
      const point = endpoints[k]
      const name = point.route_type === 'via' ? point.to_layer : point.layer
      endpointsByPosition.set(JSON.stringify([netForLane.get(lane.port), round(point.x), round(point.y), name]), endpointsByPosition.get(JSON.stringify([netForLane.get(lane.port), round(point.x), round(point.y), name])) ?? `${k ? 'OUT' : 'IN'}${mappings.length - 1}`)
    }
    for (const id of connectedSourceIds(cj, from.source_port_id)) laneNets.set(id, lane.port)
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]
      const b = route[i]
      const name = a.route_type === 'via' ? a.to_layer : a.layer
      const physical = layer(name)
      const start = node(lane.port, a.x, a.y, name)
      const finish = node(lane.port, b.x, b.y, b.route_type === 'via' ? b.to_layer : b.layer)
      if (b.route_type === 'via') {
        if (Math.hypot(b.x - a.x, b.y - a.y) > numerics.endpointToleranceMm) fail('via_geometry', 'Via must follow a co-located wire')
        const plating = stackup.viaPlatingMm
        if (!plating || plating <= 0) fail('via_plating', `${lane.port}: pcb_stackup.plated_hole_copper_thickness is required`)
        const via = cj.find(r => r.type === 'pcb_via' && Math.hypot(r.x - b.x, r.y - b.y) < numerics.endpointToleranceMm && r.pcb_trace_id === trace.pcb_trace_id)
        if (!via || via.type !== 'pcb_via') fail('via_geometry', `${lane.port}: physical via pad/barrel dimensions required`)
        const antipad = antipadDiameter(cj, via, ground.ids)
        const bottom = layer(b.to_layer)
        const length = Math.abs((physical.zMinMm + physical.zMaxMm - bottom.zMinMm - bottom.zMaxMm) / 2)
        cells.push({ stage: 0, profile: 'via', lengthM: length / 1000, ports: [{ lane: lane.port, from: start, to: finish }], start: [a.x, a.y], end: [b.x, b.y], via: {
          holeMm: via.hole_diameter, padMm: via.outer_diameter, antipadMm: antipad, platingMm: plating, lengthMm: length, er: stackup.relativePermittivity, conductivitySm: physical.conductivitySm } })
        mapping.stages.push({ kind: 'via', profile: 'via', lengthMm: length, widthMm: via.outer_diameter, thicknessMm: plating })
        continue
      }
      if (b.layer !== name) fail('layer_transition', 'A physical via is required for every layer change')
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length < numerics.boundaryToleranceMm) continue
      if (b.width_interpolation_mode || b.start_width !== undefined || b.end_width !== undefined) fail('varying_width', 'Continuous tapers require a nonuniform transmission model')
      let dx = (b.x - a.x) / length
      let dy = (b.y - a.y) / length
      const forward = dx > numerics.directionTolerance || (Math.abs(dx) < numerics.directionTolerance && dy > 0)
      if (!forward) {
        dx = -dx
        dy = -dy
      }
      const ta = a.x * dx + a.y * dy
      const tb = b.x * dx + b.y * dy
      edges.push({ id: trace.pcb_trace_id + '-' + i, lane: lane.port, a: [a.x, a.y], b: [b.x, b.y], layer: name, width: b.width, dx, dy, lo: Math.min(ta, tb), hi: Math.max(ta, tb), forward, from: start, to: finish })
      shapes.push({ id: trace.pcb_trace_id + '-' + i, net: lane.port, layer: name, polygon: wirePolygon([a.x, a.y], [b.x, b.y], b.width) })
      mapping.stages.push({ kind: 'wire', profile: name, lengthMm: length, widthMm: b.width, thicknessMm: physical.zMaxMm - physical.zMinMm })
    }
  }
  for (const pour of cj.filter(r => r.type === 'pcb_copper_pour')) {
    if (pour.shape !== 'brep' || [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings].some(r => r.vertices.some(v => v.bulge))) fail('ground_geometry', 'Copper pours require straight BREP boundaries')
    const net = ground.ids.has(pour.source_net_id ?? '') ? 'GROUND' : laneNets.get(pour.source_net_id ?? '')
    if (!net) fail('slice_conductor', `${pour.pcb_copper_pour_id}: unselected driven copper needs an electrical channel binding`)
    shapes.push({ id: pour.pcb_copper_pour_id, net, layer: pour.layer, polygon: [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings].map(r => r.vertices.map(v => [v.x, v.y])) })
  }
  for (const trace of cj.filter(r => r.type === 'pcb_trace').filter(r => !selected.has(r.source_trace_id ?? ''))) {
    const source = cj.find(r => r.type === 'source_trace' && r.source_trace_id === trace.source_trace_id)
    if (!source || source.type !== 'source_trace') fail('slice_conductor', `${trace.pcb_trace_id}: missing electrical identity`)
    const ids = [...source.connected_source_port_ids, ...(source.connected_source_net_ids ?? [])]
    const net = ids.some(id => ground.ids.has(id) || rails.has(id)) ? 'GROUND' : ids.map(id => laneNets.get(id)).find(Boolean)
    if (!net) fail('slice_conductor', `${trace.pcb_trace_id}: unselected driven trace requires a channel binding`)
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]
      const b = trace.route[i]
      if (a.route_type === 'wire' && b.route_type === 'wire' && Math.hypot(a.x - b.x, a.y - b.y) > numerics.boundaryToleranceMm) shapes.push({ id: trace.pcb_trace_id + '-' + i, net, physicalNet: ids.some(id=>ground.ids.has(id)) ? 'GROUND' : [...connectedSourceIds(cj,ids[0])].sort()[0], layer: b.layer, polygon: wirePolygon([a.x, a.y], [b.x, b.y], b.width) })
    }
  }
  for (const pad of cj.filter(r => r.type === 'pcb_smtpad')) {
    const port = cj.find(r => r.type === 'pcb_port' && r.pcb_port_id === pad.pcb_port_id)
    const id = port?.type === 'pcb_port' ? port.source_port_id : ''
    const net = ground.ids.has(id) || rails.has(id) ? 'GROUND' : laneNets.get(id) ?? `FLOAT_${pad.pcb_smtpad_id}`
    if (pad.shape !== 'rect') fail('slice_conductor', `${pad.pcb_smtpad_id}: only rectangular pad boundaries are implemented`)
    const angle = ((Reflect.get(pad, 'rotation') as number | undefined) ?? 0) * Math.PI / 180
    shapes.push({ id: pad.pcb_smtpad_id, net, physicalNet: ground.ids.has(id) ? 'GROUND' : [...connectedSourceIds(cj,id)].sort()[0], layer: pad.layer, polygon: [[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [pad.x + x * pad.width / 2 * Math.cos(angle) - y * pad.height / 2 * Math.sin(angle), pad.y + x * pad.width / 2 * Math.sin(angle) + y * pad.height / 2 * Math.cos(angle)])] })
  }
  const directions = new Map(edges.map(e => [`${round(e.dx)},${round(e.dy)}`, [e.dx, e.dy]]))
  for (const [key, [dx, dy]] of [...directions].sort(([a], [b]) => a.localeCompare(b))) {
    const parallel = edges.filter(e => `${round(e.dx)},${round(e.dy)}` === key)
    const cuts = [...new Set([...parallel.flatMap(e => [round(e.lo), round(e.hi)]), ...shapes.flatMap(s => s.polygon.flat().map(p => round(p[0] * dx + p[1] * dy)))])].sort((a, b) => a - b)
    for (let k = 1; k < cuts.length; k++) {
      const lo = cuts[k - 1]
      const hi = cuts[k]
      const t = (lo + hi) / 2
      const pieces = parallel.filter(e => e.lo < t && e.hi > t).sort((a, b) => a.lane.localeCompare(b.lane) || a.id.localeCompare(b.id))
      const groups: Edge[][] = []
      for (const piece of pieces) {
        const group = groups.find(g => netForLane.get(g[0].lane) === netForLane.get(piece.lane) && g[0].layer === piece.layer && Math.abs(-dy * (g[0].a[0] - piece.a[0]) + dx * (g[0].a[1] - piece.a[1])) < numerics.directionTolerance)
        if (group) group.push(piece)
        else groups.push([piece])
      }
      const active = groups.map(g => g[0])
      if (!active.length || hi - lo < 1e-7) continue
      const order = active.map(e => e.id)
      const bounds = sliceIntervals(outline, dx, dy, t)
      const slice: CrossSection = { activeCount: order.length, conductors: [], dielectrics: stackup.dielectrics.flatMap(d => bounds.map(([xMin, xMax]) => ({ xMin, xMax, zMin: d.zMinMm, zMax: d.zMaxMm, er: d.relativePermittivity, lossTangent: d.lossTangent }))) }
      const floating = new Map<string, number>()
      for (const shape of shapes) {
        const physical = layer(shape.layer)
        const intervals = sliceIntervals(shape.polygon, dx, dy, t)
        if (!intervals.length) continue
        const own = edges.find(e => e.id === shape.id)
        // Domain decomposition: each bend leg is extruded only in its propagation direction.
        // Including its connected transverse leg would short a folded lane in the fictitious 2D extrusion.
        if (own && !pieces.includes(own) && active.some(e => netForLane.get(e.lane) === netForLane.get(own.lane) && [e.from, e.to].some(n => n === own.from || n === own.to))) continue
        let group = shape.net === 'GROUND' ? -1 : groups.findIndex(g => g.some(e => e.id === shape.id))
        if (group < 0 && shape.net !== 'GROUND') {
          const center = intervals.reduce((s, [a, b]) => s + (a + b) / 2, 0) / intervals.length
          const candidates = active.map((e, i) => ({e,i,distance:Math.abs(-dy * e.a[0] + dx * e.a[1] - center)})).filter(c => netForLane.get(c.e.lane) === netForLane.get(shape.net)).sort((a, b) => a.distance - b.distance)
          if (candidates.length) group = candidates[0].i
        }
        if (group < 0 && shape.net !== 'GROUND') {
          const key = netForLane.get(shape.net) ?? shape.net
          if (!floating.has(key)) floating.set(key, order.length + floating.size)
          group = floating.get(key)!
        }
        for (const [xMin, xMax] of intervals) if (xMax - xMin > numerics.boundaryToleranceMm) slice.conductors.push({ id: shape.id, group, physicalNet: shape.physicalNet ?? netForLane.get(shape.net) ?? shape.net, xMin: round(xMin), xMax: round(xMax), zMin: physical.zMinMm, zMax: physical.zMaxMm, conductivitySm: physical.conductivitySm })
      }
      if (!slice.conductors.some(c => c.group === -1)) fail('slice_ground', `No board ground crosses slice ${key} at ${t} mm; a 2D return cannot be determined`)
      mergeConductors(slice)
      const ports = active.map(e => {
        /** Junction at an interval boundary, shared by all slices along this wire. */
        const at = (v: number): string => node(e.lane, dx * v - dy * (-dy * e.a[0] + dx * e.a[1]), dy * v + dx * (-dy * e.a[0] + dx * e.a[1]), e.layer)
        return { lane: e.lane, from: at(lo), to: at(hi) }
      })
      cells.push({ stage: 0, profile: active.map(e => e.layer).join('+'), lengthM: (hi - lo) / 1000, ports, slice, start: [dx * lo, dy * lo], end: [dx * hi, dy * hi] })
    }
  }
  cells.forEach((c, i) => {
    c.stage = i
  })
  return { stackup, mappings, cells, groundSourcePortId: ground.port, units: { circuitJson: 'mm', geometry: 'm', conductivity: 'S/m' }, approximations: [
    'Declared ideal DC source rails are AC equipotential; their physical copper is included with reference surfaces. Distributed rail impedance is outside this model.',
    'Connected transverse bend legs belong to their own propagation segment; including them in a prismatic 2D extrusion would create a nonphysical short. Bend fringing is excluded.',
    'Local quasi-TEM cross-sections at segment midpoints; radiation and bend fringing require a 3D full-wave model and are excluded.',
    'Only co-propagating parallel wires share distributed magnetic coupling; oblique conductors have electrostatic floating-charge coupling in each local slice.',
    'Floating pads are neutral conductors, eliminated by a Schur complement; inner copper etch gaps have no inferred resin fill.',
    'Vias use cited lumped barrel/pad/antipad formulas; a missing circular antipad is a named error. Ground is the connected board ground net.',
  ] }
}
/** Geometry and segment-map artifacts contain only deterministic physical values. */
export function channelGeometry(board: Board, modeling: BoardModeling, scope: ArtifactScope): Produced<Geometry> {
  const value = geometryFromCircuitJson(board.circuitJson, modeling)
  return { value, artifacts: [scope.json('geometry.json', value), scope.json('segment-map.json', value.cells)] }
}
