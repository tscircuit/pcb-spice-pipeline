import type { CircuitJson } from '../schema'
import { connectedSourceIds } from '../connectivity'

export interface CopperScope {
  lateralDistanceMm: number
  selectedPcbTraceIds: string[]
  pcbTraceIds: string[]
  pcbViaIds: string[]
  pcbCopperPourIds: string[]
  nearbyPadIds: string[]
  openPadIds: string[]
  padOnlySourcePortIds: string[]
  nonReferenceRailTraceIds: string[]
  nearbyNonReferencePourIds: string[]
  unassociatedCopper: string[]
  omitted: { traces: number; vias: number; pours: number }
  approximation: string
}

/** Unsupported retained copper is an explicit admission limit, never quietly discarded. */
export function copperScopeRejections(scope: CopperScope): string[] {
  return [
    ...(scope.unassociatedCopper.length ? [`Channel scope contains ${scope.unassociatedCopper.length} copper records without electrical association`] : []),
    ...(scope.nonReferenceRailTraceIds.length ? [`Channel scope requires multi-net rail copper extraction for ${scope.nonReferenceRailTraceIds.length} routed rail traces`] : []),
    ...(scope.nearbyNonReferencePourIds.length ? [`Channel scope requires multi-net plane extraction for ${scope.nearbyNonReferencePourIds.length} nearby non-reference pours`] : []),
    ...(scope.padOnlySourcePortIds.length ? [`Channel scope requires pad-only neighbour extraction for ${scope.padOnlySourcePortIds.length} physical ports`] : []),
  ]
}

interface Box { x0: number; x1: number; y0: number; y1: number; lo: number; hi: number }

/**
 * Board-world XY in mm (+X right, +Y top); layers ordered top to bottom.
 * Conservative segment bounding boxes retain copper on the same/adjacent layers
 * within the caller's admission cap in XY. Entire electrically connected nets are retained.
 * The 3D default is 1 mm; routed 2D uses 32 mm before its solved pair screen.
 * The cap is not an electromagnetic error bound.
 */
export function channelCopperScope(circuit: CircuitJson, selected: Set<string>, reference: Set<string>, rails: Set<string> = new Set(), distanceMm: number = 1): CopperScope {
  const count = circuit.find(record => record.type === 'pcb_board')?.num_layers ?? 2
  const layers = ['top', ...Array.from({ length: count - 2 }, (_, i) => `inner${i + 1}`), 'bottom']
  const traces = circuit.filter(record => record.type === 'pcb_trace')
  const sources = circuit.filter(record => record.type === 'source_trace')
  const vias = circuit.filter(record => record.type === 'pcb_via')
  const pours = circuit.filter(record => record.type === 'pcb_copper_pour')
  const ports = new Map(circuit.filter(record => record.type === 'pcb_port').map(port => [port.pcb_port_id, port.source_port_id]))
  const pads = circuit.filter(record => record.type === 'pcb_smtpad' || record.type === 'pcb_plated_hole')
  const source = new Map(sources.map(trace => [trace.source_trace_id, trace]))
  /** Electrical membership stays independent of spatial proximity. */
  const members = (id: string | undefined): string[] => {
    const trace = id && source.get(id)
    return trace ? [...trace.connected_source_port_ids, ...(trace.connected_source_net_ids ?? [])] : []
  }
  /** A conservative box; unknown layer/shape stays eligible on every layer. */
  const box = (points: { x: number; y: number }[], names: string[], radius: number = 0): Box => {
    const indices = names.map(name => layers.indexOf(name))
    return { x0: Math.min(...points.map(p => p.x)) - radius, x1: Math.max(...points.map(p => p.x)) + radius,
      y0: Math.min(...points.map(p => p.y)) - radius, y1: Math.max(...points.map(p => p.y)) + radius,
      lo: indices.some(i => i < 0) ? 0 : Math.min(...indices), hi: indices.some(i => i < 0) ? count - 1 : Math.max(...indices) }
  }
  const boxes = new Map(traces.map(trace => [trace.pcb_trace_id, trace.route.slice(1).map((b, i) => {
    const a = trace.route[i]
    const names = b.route_type === 'via' ? [b.from_layer, b.to_layer] : [a.route_type === 'via' ? a.to_layer : a.route_type === 'wire' ? a.layer : a.end_layer, b.route_type === 'wire' ? b.layer : b.end_layer]
    return box([a, b].flatMap(p => p.route_type === 'through_pad' ? [p.start, p.end] : [p]), names, Math.max(...[a, b].map(p => p.route_type === 'wire' ? p.width / 2 : 0)))
  })]))
  /** Native route vias may carry only pcb_trace_id, rather than source_trace_id. */
  const viaMembers = (via: typeof vias[number]): string[] => [...members(via.source_trace_id ?? traces.find(trace => trace.pcb_trace_id === via.pcb_trace_id)?.source_trace_id), ...(via.source_net_id ? [via.source_net_id] : [])]
  const selectedTraces = traces.filter(trace => members(trace.source_trace_id).some(id => selected.has(id)))
  const seeds = selectedTraces.flatMap(trace => boxes.get(trace.pcb_trace_id)!)
  /** Circumscribed pad boxes preserve rotation and through-hole layer spans conservatively. */
  const padBox = (pad: typeof pads[number]): Box => {
    if (pad.type === 'pcb_smtpad' && pad.shape === 'polygon') return box(pad.points, [pad.layer])
    const radius = pad.shape === 'circle' && pad.type === 'pcb_smtpad' ? pad.radius :
      Math.hypot(Number(Reflect.get(pad, 'width') ?? Reflect.get(pad, 'outer_width') ?? Reflect.get(pad, 'outer_diameter')),
        Number(Reflect.get(pad, 'height') ?? Reflect.get(pad, 'outer_height') ?? Reflect.get(pad, 'outer_diameter'))) / 2
    return box([pad], pad.type === 'pcb_smtpad' ? [pad.layer] : pad.layers, Number.isFinite(radius) ? radius : Infinity)
  }
  for (const pad of pads) if (pad.pcb_port_id && selected.has(ports.get(pad.pcb_port_id) ?? '')) seeds.push(padBox(pad))
  // Physical barrel spans, including inactive stubs, participate in neighbour selection.
  for (const via of vias) if (viaMembers(via).some(id => selected.has(id)))
    seeds.push(box([via], via.layers, via.outer_diameter / 2))
  /** Euclidean distance between bounding boxes is a lower bound on copper distance. */
  const nearby = (candidate: Box): boolean => seeds.some(seed =>
    candidate.lo <= seed.hi + 1 && seed.lo <= candidate.hi + 1 &&
    Math.hypot(Math.max(0, seed.x0 - candidate.x1, candidate.x0 - seed.x1), Math.max(0, seed.y0 - candidate.y1, candidate.y0 - seed.y1)) <= distanceMm)
  const retained = new Set(selected)
  const unassociatedCopper: string[] = []
  /** Retain the entire electrical net, with all branches and endpoint terminations. */
  const retain = (ids: string[], label: string): void => {
    if (!ids.length) unassociatedCopper.push(label)
    for (const id of ids) if (!retained.has(id)) for (const connected of connectedSourceIds(circuit, id)) retained.add(connected)
  }
  for (const trace of traces) if (boxes.get(trace.pcb_trace_id)!.some(nearby)) retain(members(trace.source_trace_id), `trace ${trace.pcb_trace_id}`)
  for (const via of vias) if (nearby(box([via], via.layers, via.outer_diameter / 2))) retain(viaMembers(via), `via ${via.pcb_via_id}`)
  const nearbyPads = pads.filter(pad => nearby(padBox(pad)))
  for (const pad of nearbyPads) if (pad.pcb_port_id && ports.has(pad.pcb_port_id)) retain([ports.get(pad.pcb_port_id)!], pad.pcb_port_id)
  const passivePorts = circuit.filter(record => record.type === 'source_component').filter(component => ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(component.ftype))
    .map(component => circuit.filter(record => record.type === 'source_port').filter(port => port.source_component_id === component.source_component_id).map(port => port.source_port_id))
  let changed = true
  while (changed) {
    changed = false
    for (const pins of passivePorts) if (pins.length === 2 && !pins.some(pin => rails.has(pin) || reference.has(pin)) && pins.some(pin => retained.has(pin))) {
      for (const pin of pins) if (!retained.has(pin)) {
        retain([pin], pin)
        changed = true
      }
    }
  }
  const keptTraces = traces.filter(trace => members(trace.source_trace_id).some(id => retained.has(id)))
  const keptVias = vias.filter(via => viaMembers(via).some(id => retained.has(id) || reference.has(id)))
  const keptPours = pours.filter(pour => {
    if (pour.source_net_id && reference.has(pour.source_net_id)) return true
    if (pour.shape !== 'brep') return true // Unsupported shapes cannot disappear by scoping.
    return nearby(box(pour.brep_shape.outer_ring.vertices, [pour.layer]))
  })
  const padOnlySourcePortIds = new Set<string>()
  const openPadIds: string[] = []
  for (const pad of nearbyPads) {
    const port = pad.pcb_port_id && ports.get(pad.pcb_port_id)
    if (!port) {
      openPadIds.push(pad.type === 'pcb_smtpad' ? pad.pcb_smtpad_id : pad.pcb_plated_hole_id)
      continue
    }
    if (selected.has(port) || rails.has(port) || reference.has(port)) continue
    const net = connectedSourceIds(circuit, port)
    if (keptTraces.some(trace => members(trace.source_trace_id).some(id => net.has(id)))) continue
    if (net.size > 1) padOnlySourcePortIds.add(port)
    else openPadIds.push(pad.type === 'pcb_smtpad' ? pad.pcb_smtpad_id : pad.pcb_plated_hole_id)
  }
  return { lateralDistanceMm: distanceMm, selectedPcbTraceIds: selectedTraces.map(trace => trace.pcb_trace_id),
    pcbTraceIds: keptTraces.map(trace => trace.pcb_trace_id), pcbViaIds: keptVias.map(via => via.pcb_via_id), pcbCopperPourIds: keptPours.map(pour => pour.pcb_copper_pour_id),
    nearbyPadIds: nearbyPads.map(pad => pad.type === 'pcb_smtpad' ? pad.pcb_smtpad_id : pad.pcb_plated_hole_id),
    padOnlySourcePortIds: [...padOnlySourcePortIds], openPadIds,
    nonReferenceRailTraceIds: keptTraces.filter(trace => members(trace.source_trace_id).some(id => rails.has(id)) && !members(trace.source_trace_id).some(id => reference.has(id))).map(trace => trace.pcb_trace_id),
    nearbyNonReferencePourIds: keptPours.filter(pour => !pour.source_net_id || !reference.has(pour.source_net_id)).map(pour => pour.pcb_copper_pour_id), unassociatedCopper,
    omitted: { traces: traces.length - keptTraces.length, vias: vias.length - keptVias.length, pours: pours.length - keptPours.length },
    approximation: `Coupling scope: whole nets with copper within ${distanceMm} mm XY bounding-box distance on the same/adjacent copper layers of selected routes, pads or physical barrels; all connected reference pours retained. More distant nets and nonadjacent-layer coupling omitted; no field-error bound. Non-selected modelled pins use existing quiet/terminated states; unsupported neighbours fail explicitly. Pads select nets but their arbitrary shape is omitted by the routed-wire approximation, except return contacts; connected pad-only neighbours fail explicitly. ${openPadIds.length} unmapped or electrically unconnected pad bodies omitted with the existing open unused-lead approximation (no die loads or switching).` }
}
