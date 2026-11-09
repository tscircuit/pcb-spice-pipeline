import { connectedSourceIds, type CircuitJson } from '../board'

/** Copper reachable through two-terminal passives, excluding power and ground branches. */
export function signalTopology(circuit: CircuitJson, seed: string, rails: Set<string>, stops: Set<string> = new Set()): Set<string> {
  const found = connectedSourceIds(circuit, seed)
  const ports = circuit.filter(r => r.type === 'source_port')
  const passives = circuit.filter(r => r.type === 'source_component').filter(r => ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype))
  let changed = true
  while (changed) {
    changed = false
    for (const component of passives) {
      const pins = ports.filter(port => port.source_component_id === component.source_component_id).map(port => port.source_port_id)
      if (pins.length !== 2 || pins.some(pin => [...connectedSourceIds(circuit, pin)].some(id => stops.has(id))) || pins.some(pin => rails.has(pin)) || !pins.some(pin => found.has(pin))) continue
      for (const pin of pins) for (const id of connectedSourceIds(circuit, pin)) if (!found.has(id)) {
        found.add(id)
        changed = true
      }
    }
  }
  return found
}

/** Verify physical connectivity through passives and reject branched routed graphs independently of source grouping. */
export function validateSignalGraph(circuit: CircuitJson, signals: import('../board').SimulationSignal[], rails: Set<string>, unrouted: 'error' | 'ideal'): void {
  const routes = circuit.filter(r => r.type === 'pcb_trace')
  const ports = circuit.filter(r => r.type === 'pcb_port')
  const edges: { a: string; b: string; layer: string; ax: number; ay: number; bx: number; by: number }[] = []
  const points = new Map<string, { x: number; y: number; layer: string }>()
  const graph = new Map<string, Set<string>>()
  /** Stable physical identity at the geometry admission tolerance. */
  const point = (x: number, y: number, layer: string): string => {
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${layer}`
    points.set(key, { x, y, layer })
    return key
  }
  /** Undirected physical edge. */
  const join = (a: string, b: string): void => {
    if (a === b) return
    if (!graph.has(a)) graph.set(a, new Set())
    if (!graph.has(b)) graph.set(b, new Set())
    graph.get(a)!.add(b)
    graph.get(b)!.add(a)
  }
  for (const route of routes) for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]
    const b = route.route[i]
    if (a.route_type === 'through_pad' || b.route_type === 'through_pad') continue
    const layer = a.route_type === 'via' ? a.to_layer : a.layer
    const ak = point(a.x, a.y, layer)
    const bk = point(b.x, b.y, b.route_type === 'via' ? b.from_layer : b.layer)
    if (b.route_type === 'via') join(point(b.x, b.y, b.from_layer), point(b.x, b.y, b.to_layer))
    if (ak !== bk) edges.push({ a: ak, b: bk, layer, ax: a.x, ay: a.y, bx: b.x, by: b.y })
  }
  const terminals = new Map<string, string[]>()
  for (const port of ports) terminals.set(port.source_port_id, port.layers.map(layer => point(port.x, port.y, layer)))
  // Split at every physical junction, including a branch terminating inside another segment.
  for (const edge of edges) {
    const dx = edge.bx - edge.ax
    const dy = edge.by - edge.ay
    const length = dx * dx + dy * dy
    const vertices = [...points].flatMap(([key, p]) => {
      const t = ((p.x - edge.ax) * dx + (p.y - edge.ay) * dy) / length
      return p.layer === edge.layer && t >= -1e-8 && t <= 1 + 1e-8 && Math.abs((p.x - edge.ax) * dy - (p.y - edge.ay) * dx) < 1e-5 * Math.sqrt(length) ? [{ key, t }] : []
    }).sort((a, b) => a.t - b.t)
    for (let i = 1; i < vertices.length; i++) join(vertices[i - 1].key, vertices[i].key)
  }
  for (const source of circuit.filter(r => r.type === 'source_port')) if (!terminals.has(source.source_port_id)) {
    const copper = connectedSourceIds(circuit, source.source_port_id)
    terminals.set(source.source_port_id, ports.filter(p => copper.has(p.source_port_id)).flatMap(p => terminals.get(p.source_port_id) ?? []))
  }
  const copperGraph = new Map([...graph].map(([key, values]) => [key, new Set(values)]))
  for (const component of circuit.filter(r => r.type === 'source_component').filter(r => ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype))) {
    const pins = circuit.filter(r => r.type === 'source_port').filter(r => r.source_component_id === component.source_component_id).map(p => p.source_port_id)
    if (pins.length === 2 && !pins.some(pin => rails.has(pin))) for (const a of terminals.get(pins[0]) ?? []) for (const b of terminals.get(pins[1]) ?? []) join(a, b)
  }
  /** All vertices physically reachable from the given terminals. */
  const reachable = (starts: string[], network: Map<string, Set<string>>): Set<string> => {
    const found = new Set(starts)
    for (const key of found) for (const next of network.get(key) ?? []) found.add(next)
    return found
  }
  for (const signal of signals) {
    const driver = signal.driver.kind === 'single' ? [signal.driver.source_port_id] : [signal.driver.p_source_port_id, signal.driver.n_source_port_id]
    for (const [leg, port] of driver.entries()) {
      const topology = signalTopology(circuit, port, rails)
      const starts = terminals.get(port) ?? []
      const connected = reachable(starts, graph)
      const copper = reachable(starts, copperGraph)
      const routed = [...copper].some(key => copperGraph.has(key))
      if (routed && (signal.receivers.length > 1 || starts.some(key => (copperGraph.get(key)?.size ?? 0) > 1) || [...connected].some(key => (copperGraph.get(key)?.size ?? 0) > 2))) throw new Error(`Signal "${signal.name}": branched routed graphs are not implemented yet.`)
      if (unrouted === 'ideal') continue
      const receivers = signal.receivers.map(receiver => receiver.kind === 'single' ? receiver.source_port_id : leg === 0 ? receiver.p_source_port_id : receiver.n_source_port_id)
      const required = circuit.filter(r => r.type === 'source_trace').filter(r => r.connected_source_port_ids.some(id => topology.has(id)) && !r.connected_source_port_ids.some(id => rails.has(id))).flatMap(r => r.connected_source_port_ids)
      for (const target of new Set([...receivers, ...required])) if (!(terminals.get(target) ?? []).some(key => connected.has(key))) throw new Error(`Signal "${signal.name}" is not routed between ${port} and ${target}.`)
    }
  }
}
