import { connectedSourceIds, routeContactFrame } from '../board'
import { referenceSeries, sectionInverse, type ExtractedRouteSlice, type Matrix, type RouteCoefficients } from '../extraction'
import type { RouteNetworkInput } from './routed-types'

/** Opt-in handling of scoped routed nets that have no IBIS endpoint binding. */
export interface BoundScopeRule {
  /** Keep an unbound net only when its largest local |k| or normalized mutual C to a bound net exceeds this; omit to keep every net. */
  couplingThreshold?: number
  /** Eliminate removed nets from C, C0 and G as locally floating conductors (Schur complement) instead of AC-grounding them. */
  foldRemoved?: boolean
  /** Terminate every contacted pad of each kept unbound net in its length-weighted characteristic impedance. */
  terminateKept?: boolean
}
export interface ScopeNet {
  id: string
  sources: string[]
  ports: string[]
  /** At least one port is a compiled IBIS signal pin. */
  bound: boolean
  /** Largest local coupling coefficient to any bound net; zero for bound nets. */
  coupling: number
  impedanceOhm: number
  lengthMm: number
}

/** Routed nets from source connectivity; ideal rail wires are references, never nets. */
export function routeScopeNets(input: RouteNetworkInput): ScopeNet[] {
  const { circuitJson, scope, models } = input.bindings
  const rails = new Set(scope.nonReferenceRailTraceIds)
  const traces = circuitJson.filter(record => record.type === 'source_trace')
  const pins = new Set(models.flatMap(model => model.metadata.pins.map(pin => pin.port)))
  const nets: ScopeNet[] = []
  for (const wire of input.geometry.wires) {
    if (rails.has(wire.trace) || nets.some(net => net.sources.includes(wire.source))) continue
    const trace = traces.find(trace => trace.source_trace_id === wire.source)
    if (!trace?.connected_source_port_ids.length) throw new Error(`Scope rule requires source connectivity for ${wire.source}`)
    const ports = connectedSourceIds(circuitJson, trace.connected_source_port_ids[0])
    const existing = nets.find(net => net.ports.some(port => ports.has(port)))
    if (existing) existing.sources.push(wire.source)
    else nets.push({ id: wire.source, sources: [wire.source], ports: [...ports], bound: [...ports].some(port => pins.has(port)), coupling: 0, impedanceOhm: 0, lengthMm: 0 })
  }
  const owner = new Map(nets.flatMap(net => net.sources.map(source => [source, net] as const)))
  for (const slice of input.extracted.slices) {
    const series = referenceSeries(slice.line, slice.wires.flatMap((wire, i) => rails.has(wire.trace) ? [i] : []))
    const lengthMm = slice.end - slice.start
    for (const [i, wire] of slice.wires.entries()) {
      const net = owner.get(wire.source)
      if (!net) continue
      net.lengthMm += lengthMm
      net.impedanceOhm += lengthMm * Math.sqrt(series.L[i][i] / slice.line.C[i][i])
      if (net.bound) continue
      for (const [j, other] of slice.wires.entries()) if (owner.get(other.source)?.bound) {
        const inductive = Math.abs(series.L[i][j]) / Math.sqrt(series.L[i][i] * series.L[j][j])
        const capacitive = Math.abs(slice.line.C[i][j]) / Math.sqrt(slice.line.C[i][i] * slice.line.C[j][j])
        net.coupling = Math.max(net.coupling, inductive, capacitive)
      }
    }
  }
  for (const net of nets) net.impedanceOhm /= net.lengthMm || 1
  return nets
}

/** Kron-reduce removed indices from a symmetric matrix: removed conductors carry zero local charge. */
function floating(matrix: Matrix, kept: number[], removed: number[]): Matrix {
  const inverse = sectionInverse(removed.map(i => removed.map(j => matrix[i][j])))
  return kept.map(i => kept.map(j => matrix[i][j] - removed.reduce((total, a, p) => total + matrix[i][a] * removed.reduce((inner, b, q) => inner + inverse[p][q] * matrix[b][j], 0), 0)))
}

/** Apply one scope rule to solved network input without another field solve; bound nets, models and probes are unchanged. */
export function boundScopeInput(input: RouteNetworkInput, rule: BoundScopeRule): RouteNetworkInput {
  if (input.options.returnPath) throw new Error('Scope rules do not support finite shared-return networks')
  if (rule.couplingThreshold !== undefined && !(rule.couplingThreshold >= 0)) throw new Error('Coupling threshold must be nonnegative')
  const nets = routeScopeNets(input)
  const kept = nets.filter(net => net.bound || rule.couplingThreshold === undefined || net.coupling > rule.couplingThreshold)
  const sources = new Set(kept.flatMap(net => net.sources))
  const rails = new Set(input.bindings.scope.nonReferenceRailTraceIds)
  const wires = input.geometry.wires.filter(wire => sources.has(wire.source) || rails.has(wire.trace))
  const traces = new Set(wires.map(wire => wire.trace))
  /** Principal submatrices keep removed currents at zero; C/G either ground or float the removed conductors. */
  const slice = (slice: ExtractedRouteSlice): ExtractedRouteSlice => {
    const indices = slice.wires.flatMap((wire, i) => sources.has(wire.source) || rails.has(wire.trace) ? [i] : [])
    if (indices.length === slice.wires.length) return slice
    const removed = slice.wires.flatMap((_, i) => indices.includes(i) ? [] : [i])
    const line = { ...slice.line } as RouteCoefficients
    for (const key of ['C', 'C0', 'L', 'dcResistance', 'skinResistance', 'dielectricLoss'] as const)
      line[key] = rule.foldRemoved && indices.length && ['C', 'C0', 'dielectricLoss'].includes(key) ? floating(slice.line[key], indices, removed) : indices.map(i => indices.map(j => slice.line[key][i][j]))
    line.conductorIds = indices.map(i => slice.line.conductorIds[i])
    const key = JSON.stringify({ ...JSON.parse(slice.key), boundScope: { originalIndices: indices, removedConductors: rule.foldRemoved ? 'locally floating' : 'AC grounded', removedCurrents: 'zero' } })
    return { ...slice, key, wires: indices.map(i => slice.wires[i]), line }
  }
  const slices = input.extracted.slices.map(slice).filter(slice => slice.wires.length)
  const scope = { ...input.bindings.scope, pcbTraceIds: input.bindings.scope.pcbTraceIds.filter(id => traces.has(id)) }
  const geometry = { ...input.geometry, wires, slices: input.geometry.slices.map(slice => ({ ...slice, wires: slice.wires.filter(wire => traces.has(wire.trace)) })).filter(slice => slice.wires.length), viaContacts: input.geometry.viaContacts.filter(contact => traces.has(contact.trace)) }
  const terminations: string[] = []
  if (rule.terminateKept) for (const net of kept.filter(net => !net.bound)) for (const port of input.bindings.circuitJson.filter(record => record.type === 'pcb_port' && net.ports.includes(record.source_port_id))) {
    if (port.type !== 'pcb_port' || !port.layers.some(layer => routeContactFrame(geometry, scope, layer, [port.x, port.y]))) continue
    terminations.push(`RZ0T${terminations.length} ${input.bindings.nodeMap[port.source_port_id]} 0 ${Number(net.impedanceOhm.toPrecision(6))}`)
  }
  const warning = `Bound-signal scope rule ${JSON.stringify(rule)}: ${kept.length}/${nets.length} routed nets kept (${nets.filter(net => net.bound).length} IBIS-bound). Removed nets ${rule.foldRemoved ? 'float locally in C/G (Schur complement)' : 'are AC-grounded in C/G'} and carry zero current; their oblique C and pad loads are omitted. ${terminations.length} kept unbound pads terminated in length-weighted Z0. No new field solve.`
  return { ...input, geometry, extracted: { ...input.extracted, slices, sections: [...new Map(slices.map(({ key, line }) => [key, { key, line }])).values()] },
    bindings: { ...input.bindings, scope, electricalLines: [...input.bindings.electricalLines, ...terminations] }, warnings: [...input.warnings, warning] }
}
