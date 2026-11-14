import { connectedSourceIds } from './connectivity'
import type { CircuitJson } from './schema'
import { routePosition, type RouteWire } from './route-sections'

/** Exact transverse metal union, with equipotential lateral joins at overlap-patch ends. */
export function unionRouteWires(wires: RouteWire[], circuit: CircuitJson): RouteWire[] {
  const nets = new Map<string, string>()
  const sources = circuit.filter(record => record.type === 'source_trace')
  const groups = new Map<string, RouteWire[]>()
  for (const wire of wires) {
    let net = nets.get(wire.source)
    if (!net) {
      const source = sources.find(source => source.source_trace_id === wire.source)!
      const port = source.connected_source_port_ids[0] ?? source.connected_source_net_ids?.[0]
      net = port ? [...connectedSourceIds(circuit, port)].sort()[0] : wire.source
      nets.set(wire.source, net)
    }
    const key = [net, wire.layer, ...wire.u.map(value => value.toFixed(7))].join(':')
    groups.set(key, [...groups.get(key) ?? [], wire])
  }
  const result: RouteWire[] = []
  for (const group of groups.values()) {
    const parents = group.map((_, i) => i)
    /** Compress a connected set of overlapping same-net copper bodies. */
    const root = (i: number): number => parents[i] === i ? i : parents[i] = root(parents[i])
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i]
      const b = group[j]
      if (Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-6 && Math.abs(a.transverse - b.transverse) <= (a.width + b.width) / 2 + 1e-7) parents[root(j)] = root(i)
    }
    const components = new Map<number, RouteWire[]>()
    for (const [i, wire] of group.entries()) components.set(root(i), [...components.get(root(i)) ?? [], wire])
    for (const component of components.values()) {
      if (component.length === 1) {
        result.push(component[0])
        continue
      }
      const cuts = [...new Set(component.flatMap(wire => [wire.start, wire.end]))].sort((a, b) => a - b)
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1]
        const end = cuts[i]
        if (end - start < 1e-7) continue
        const active = component.filter(wire => wire.start < (start + end) / 2 && wire.end > (start + end) / 2).sort((a, b) => a.transverse - b.transverse)
        const clusters: RouteWire[][] = []
        for (const wire of active) {
          const last = clusters.at(-1)
          if (last && wire.transverse - wire.width / 2 <= Math.max(...last.map(wire => wire.transverse + wire.width / 2)) + 1e-7) last.push(wire)
          else clusters.push([wire])
        }
        for (const cluster of clusters) {
          const wire = [...cluster].sort((a, b) => a.id - b.id)[0]
          const low = Math.min(...cluster.map(wire => wire.transverse - wire.width / 2))
          const high = Math.max(...cluster.map(wire => wire.transverse + wire.width / 2))
          const sign = (wire.b[0] - wire.a[0]) * wire.u[0] + (wire.b[1] - wire.a[1]) * wire.u[1] > 0 ? 1 : -1
          const body = { ...wire, start, end, width: high - low, transverse: (low + high) / 2 }
          const a = routePosition(body, sign > 0 ? start : end)
          const b = routePosition(body, sign > 0 ? end : start)
          const joins = cluster.flatMap(original => [start, end].map(position => ({ source: original.source, trace: original.trace, from: routePosition(original, position), to: routePosition(body, position) })))
            .filter(join => Math.hypot(join.from[0] - join.to[0], join.from[1] - join.to[1]) > 1e-7)
          result.push({ ...body, a, b, joins })
        }
      }
    }
  }
  const original = new Map(wires.map(wire => [wire.id, wire]))
  result.sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id
    const wire = original.get(a.id)!
    const sign = (wire.b[0] - wire.a[0]) * wire.u[0] + (wire.b[1] - wire.a[1]) * wire.u[1] > 0 ? 1 : -1
    return sign * (a.start - b.start)
  })
  return result.map((wire, id) => ({ ...wire, id }))
}
