import { connectedSourceIds } from '../board'
import { referenceSeries, type ExtractedRouteSlice, type RouteCoefficients } from '../extraction'
import { routeDelayBound } from './route-ladder'
import type { RouteNetworkInput, RoutedDeck } from './routed-types'

export interface RouteNet { id: string; name: string; sources: string[]; ports: string[] }
export interface RoutePair {
  nets: [string, string]
  inductive: number
  capacitive: number
  capacitanceF: number
  inductanceH: number
  resistanceOhm: number
  skinResistance: number
  dielectricLossF: number
  hard: boolean
}
export interface RouteGraph { nets: RouteNet[]; pairs: RoutePair[] }
export interface RoutePartition {
  mode: 'exact' | 'victim-window'
  victim?: string
  threshold: number
  nets: string[]
  /** Absolute quadratic-form cross-term bounds, evaluated at stated amplitude limits, not measured energy or waveform error. */
  dropped: { pairs: number; electricJ: number; magneticJ: number; resistanceW: number; skinWPerRootHz: number; dielectricJ: number; voltageV: number; currentA: number }
}

/** Build net identities from actual source connectivity, including receiver termination stubs. */
function routeNets(input: RouteNetworkInput): RouteNet[] {
  const { circuitJson, scope, mappings } = input.bindings
  const sources = [...new Set(input.geometry.wires.filter(wire => !scope.nonReferenceRailTraceIds.includes(wire.trace)).map(wire => wire.source))]
  const traces = circuitJson.filter(record => record.type === 'source_trace')
  const nets: RouteNet[] = []
  for (const source of sources) {
    if (nets.some(net => net.sources.includes(source))) continue
    const trace = traces.find(trace => trace.source_trace_id === source)
    if (!trace?.connected_source_port_ids.length) throw new Error(`Partition requires source connectivity for ${source}`)
    const ports = connectedSourceIds(circuitJson, trace.connected_source_port_ids[0])
    const members = sources.filter(id => traces.find(trace => trace.source_trace_id === id)!.connected_source_port_ids.some(port => ports.has(port)))
    const mapping = mappings.find(mapping => members.includes(mapping.sourceTraceId))
    nets.push({ id: members[0], name: mapping?.port ?? trace.name ?? members[0], sources: members, ports: [...ports] })
  }
  return nets
}

/** Include every nonzero RLGC/loss term and emitted oblique C; pair-screen records alone are insufficient for exact independence. */
export function routeGraph(input: RouteNetworkInput, compiled: RoutedDeck): RouteGraph {
  if (input.options.returnPath) throw new Error('Partitioning finite shared-return networks is not supported')
  const nets = routeNets(input)
  const sourceNet = new Map(nets.flatMap(net => net.sources.map(source => [source, net.id] as const)))
  const portNet = new Map(nets.flatMap(net => net.ports.map(port => [port, net.id] as const)))
  const selfC = new Map<string, number>()
  for (const slice of input.extracted.slices) for (const [i, wire] of slice.wires.entries()) {
    const net = sourceNet.get(wire.source)
    if (net) selfC.set(net, (selfC.get(net) ?? 0) + slice.line.C[i][i] * (slice.end - slice.start) / 1000)
  }
  const pairs = new Map<string, RoutePair>()
  /** One stable undirected record, with absolute integrated coefficients as conservative amplitude bounds. */
  const pair = (a: string | undefined, b: string | undefined): RoutePair | undefined => {
    if (!a || !b || a === b) return
    const ids = [a, b].sort() as [string, string]
    const key = JSON.stringify(ids)
    let result = pairs.get(key)
    if (!result) {
      result = { nets: ids, inductive: 0, capacitive: 0, capacitanceF: 0, inductanceH: 0, resistanceOhm: 0, skinResistance: 0, dielectricLossF: 0, hard: false }
      pairs.set(key, result)
    }
    return result
  }
  for (const slice of input.extracted.slices) {
    const rail = slice.wires.flatMap((wire, i) => sourceNet.has(wire.source) ? [] : [i])
    const series = referenceSeries(slice.line, rail)
    const metres = (slice.end - slice.start) / 1000
    for (let i = 0; i < slice.wires.length; i++) for (let j = i + 1; j < slice.wires.length; j++) {
      const record = pair(sourceNet.get(slice.wires[i].source), sourceNet.get(slice.wires[j].source))
      if (!record) continue
      const line = slice.line
      record.inductive = Math.max(record.inductive, Math.abs(series.L[i][j]) / Math.sqrt(series.L[i][i] * series.L[j][j]))
      record.capacitive = Math.max(record.capacitive, Math.abs(line.C[i][j]) / Math.sqrt(line.C[i][i] * line.C[j][j]))
      record.capacitanceF += Math.abs(line.C[i][j]) * metres
      record.inductanceH += Math.abs(series.L[i][j]) * metres
      record.resistanceOhm += Math.abs(line.dcResistance[i][j]) * metres
      record.skinResistance += Math.abs(series.skinResistance[i][j]) * metres
      record.dielectricLossF += Math.abs(line.dielectricLoss[i][j]) * metres
    }
  }
  const contacts = new Map<string, string>()
  for (const wire of input.geometry.wires) for (const point of [wire.a, wire.b, ...(wire.joins?.flatMap(join => [join.from, join.to]) ?? [])]) {
    const id = sourceNet.get(wire.source)
    if (!id) continue
    const key = `${wire.layer}:${point.map(value => value.toFixed(6)).join(',')}`
    const record = pair(id, contacts.get(key))
    if (record) record.hard = true
    contacts.set(key, id)
  }
  const wireNet = new Map(input.geometry.wires.map(wire => [wire.id, sourceNet.get(wire.source)]))
  for (const entry of compiled.evidence.oblique_encounters as { wires: number[]; capacitanceF?: number }[]) {
    if (!(entry.capacitanceF! > 1e-23)) continue
    const record = pair(wireNet.get(entry.wires[0]), wireNet.get(entry.wires[1]))
    if (record) {
      record.capacitanceF += entry.capacitanceF!
      // A stated net-integrated score for oblique C; unlike the local parallel score this is not a local field coefficient.
      record.capacitive = Math.max(record.capacitive, entry.capacitanceF! / Math.sqrt(selfC.get(record.nets[0])! * selfC.get(record.nets[1])!))
    }
  }
  // Keep differential measurements in one deck, even if their electrical legs are independent.
  for (const probe of input.bindings.plan.probes) if (probe.referenceNode !== '0') {
    const record = pair(portNet.get(probe.signalSourceId), portNet.get(probe.referenceSourceId!))
    if (record) record.hard = true
  }
  // Fixed ideal rails can be copied into independent decks. Every other shared binding node joins its loads.
  const fixed = new Set(['0'])
  for (const line of input.bindings.electricalLines) {
    const match = /^V\S+\s+(\S+)\s+0\s+[-+\d.eE]+$/i.exec(line)
    if (match) fixed.add(match[1])
  }
  const groups = new Map<string, Set<string>>()
  for (const model of input.bindings.models) {
    const members = [...new Set(model.metadata.pins.flatMap(pin => portNet.get(pin.port) ?? []))]
    for (const a of members) for (const b of members) {
      const record = pair(a, b)
      if (record) record.hard = true
    }
    for (const port of Object.values(model.spicePinMapping)) {
      const node = input.bindings.nodeMap[port]
      if (fixed.has(node)) continue
      const group = groups.get(node) ?? new Set<string>()
      members.forEach(member => group.add(member))
      groups.set(node, group)
    }
  }
  // Electrical passives and placed subcircuits are indivisible; fail closed on unknown stamps.
  let depth = 0
  for (const block of input.bindings.electricalLines) for (const line of block.split(/\r?\n/)) {
    if (/^\.subckt/i.test(line)) {
      depth++
      continue
    }
    if (/^\.ends/i.test(line)) {
      depth--
      continue
    }
    if (depth || !line.trim() || /^[*.]/.test(line)) continue
    const tokens = line.trim().split(/\s+/)
    if (!/^[RCLVX]/i.test(tokens[0])) throw new Error(`Unsupported partition electrical stamp ${tokens[0]}`)
    const nodes = tokens.slice(1, /^X/i.test(tokens[0]) ? -1 : 3).filter(node => !fixed.has(node))
    const members = [...new Set(nodes.flatMap(node => [...groups.get(node) ?? [], ...nets.filter(net => net.ports.some(port => input.bindings.nodeMap[port] === node)).map(net => net.id)]))]
    for (const node of nodes) groups.set(node, new Set(members))
  }
  // Shared auxiliary nodes and direct passive paths need transitive closure.
  let changed = true
  while (changed) {
    changed = false
    for (const values of groups.values()) for (const other of groups.values()) if ([...values].some(value => other.has(value))) {
      for (const value of other) if (!values.has(value)) {
        values.add(value)
        changed = true
      }
    }
  }
  for (const members of groups.values()) for (const a of members) for (const b of members) {
    const record = pair(a, b)
    if (record) record.hard = true
  }
  return { nets, pairs: [...pairs.values()].filter(pair => pair.hard || pair.capacitanceF || pair.inductanceH || pair.resistanceOhm || pair.skinResistance || pair.dielectricLossF) }
}

/** Exact connected components, or one-hop victim windows with indivisible physical bindings closed transitively. */
export function routePartitions(graph: RouteGraph, mode: RoutePartition['mode'], threshold: number = 0, voltageV: number = 1, currentA: number = 1): RoutePartition[] {
  if (!['exact', 'victim-window'].includes(mode) || ![threshold, voltageV, currentA].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Finite nonnegative partition threshold and amplitude limits required')
  const ids = graph.nets.map(net => net.id)
  if (new Set(ids).size !== ids.length || graph.pairs.some(pair => pair.nets.some(id => !ids.includes(id)))) throw new Error('Partition graph has duplicate or unknown nets')
  if (graph.pairs.some(pair => [pair.inductive, pair.capacitive, pair.capacitanceF, pair.inductanceH, pair.resistanceOhm, pair.skinResistance, pair.dielectricLossF].some(value => !Number.isFinite(value) || value < 0))) throw new Error('Partition graph requires finite nonnegative coupling coefficients')
  const remaining = new Set(ids)
  const results: RoutePartition[] = []
  for (const victim of ids) {
    if (mode === 'exact' && !remaining.has(victim)) continue
    const selected = new Set([victim])
    if (mode === 'victim-window') for (const pair of graph.pairs) if (pair.nets.includes(victim) && Math.max(pair.inductive, pair.capacitive) > threshold) pair.nets.forEach(id => selected.add(id))
    let changed = true
    while (changed) {
      changed = false
      for (const pair of graph.pairs) if ((mode === 'exact' || pair.hard) && pair.nets.some(id => selected.has(id))) for (const id of pair.nets) if (!selected.has(id)) {
        selected.add(id)
        changed = true
      }
    }
    selected.forEach(id => remaining.delete(id))
    const dropped = graph.pairs.filter(pair => pair.nets.some(id => selected.has(id)) && !pair.nets.every(id => selected.has(id)))
    /** Absolute cross-energy upper bound at the supplied node-voltage/current amplitude bounds. */
    const sum = (key: 'capacitanceF' | 'inductanceH' | 'resistanceOhm' | 'skinResistance' | 'dielectricLossF'): number => dropped.reduce((total, pair) => total + pair[key], 0)
    results.push({ mode, victim: mode === 'victim-window' ? victim : undefined, threshold, nets: ids.filter(id => selected.has(id)), dropped: { pairs: dropped.length, electricJ: sum('capacitanceF') * voltageV ** 2, magneticJ: sum('inductanceH') * currentA ** 2, resistanceW: 2 * sum('resistanceOhm') * currentA ** 2, skinWPerRootHz: 2 * sum('skinResistance') * currentA ** 2, dielectricJ: sum('dielectricLossF') * voltageV ** 2, voltageV, currentA } })
  }
  return results
}

/** Project existing solved matrices without another field solve; self terms remain unchanged (removed neighbours are AC-grounded in C). */
export function partitionNetworkInput(input: RouteNetworkInput, graph: RouteGraph, partition: RoutePartition): RouteNetworkInput {
  if (input.options.returnPath) throw new Error('Partitioning finite shared-return networks is not supported')
  const ids = new Set(partition.nets)
  if (!ids.size || [...ids].some(id => !graph.nets.some(net => net.id === id))) throw new Error('Partition must select known nets')
  const cut = graph.pairs.filter(pair => pair.nets.some(id => ids.has(id)) && !pair.nets.every(id => ids.has(id)))
  if (cut.some(pair => partition.mode === 'exact' || pair.hard)) throw new Error('Partition cuts a retained physical coupling or binding')
  const sources = new Set(graph.nets.filter(net => ids.has(net.id)).flatMap(net => net.sources))
  const ports = new Set(graph.nets.filter(net => ids.has(net.id)).flatMap(net => net.ports))
  const rail = new Set(input.bindings.scope.nonReferenceRailTraceIds)
  const wires = input.geometry.wires.filter(wire => sources.has(wire.source) || rail.has(wire.trace))
  const traces = new Set(wires.map(wire => wire.trace))
  /** Keep every coefficient's original diagonal and principal submatrix, including finite ideal-rail elimination. */
  const slice = (slice: ExtractedRouteSlice): ExtractedRouteSlice => {
    const indices = slice.wires.flatMap((wire, i) => sources.has(wire.source) || rail.has(wire.trace) ? [i] : [])
    const line = { ...slice.line } as RouteCoefficients
    for (const key of ['C', 'C0', 'L', 'dcResistance', 'skinResistance', 'dielectricLoss'] as const) line[key] = indices.map(i => indices.map(j => slice.line[key][i][j]))
    line.conductorIds = indices.map(i => slice.line.conductorIds[i])
    const key = indices.length === slice.wires.length ? slice.key : JSON.stringify({ ...JSON.parse(slice.key), coefficientProjection: { originalIndices: indices, electrostatic: 'excluded voltages are zero', series: 'excluded currents are zero', source: 'original solved matrices; no new field solve' } })
    return { ...slice, key, wires: indices.map(i => slice.wires[i]), line }
  }
  const slices = input.extracted.slices.map(slice).filter(slice => slice.wires.length)
  const scope = { ...input.bindings.scope, pcbTraceIds: input.bindings.scope.pcbTraceIds.filter(id => traces.has(id)), selectedPcbTraceIds: input.bindings.scope.selectedPcbTraceIds.filter(id => traces.has(id)) }
  return { ...input, geometry: { ...input.geometry, wires, slices: input.geometry.slices.map(slice => ({ ...slice, wires: slice.wires.filter(wire => traces.has(wire.trace)) })).filter(slice => slice.wires.length), viaContacts: input.geometry.viaContacts.filter(contact => traces.has(contact.trace)) }, extracted: { ...input.extracted, slices, sections: [...new Map(slices.map(({ key, line }) => [key, { key, line }])).values()] }, bindings: { ...input.bindings, scope, mappings: input.bindings.mappings.filter(mapping => sources.has(mapping.sourceTraceId)), models: input.bindings.models.filter(model => model.metadata.pins.some(pin => ports.has(pin.port))), plan: { ...input.bindings.plan, probes: input.bindings.plan.probes.filter(probe => ports.has(probe.signalSourceId) && (probe.referenceNode === '0' || ports.has(probe.referenceSourceId!))) } }, options: { ...input.options, delayBound: routeDelayBound(input.extracted), wireOrder: [...new Set(input.extracted.slices.flatMap(slice => slice.wires.map(wire => wire.id)))].sort((a, b) => a - b) }, warnings: [...input.warnings, `Research ${partition.mode} partition; ${partition.nets.length}/${graph.nets.length} nets; threshold ${partition.threshold}. Multi-pin IBIS bindings and physical/electrical contacts are indivisible; oblique C is included in the threshold and dropped-term accounting. Original quiet-driver states and terminations are retained. Self C is retained: excluded conductors remain implicit AC-grounded electrostatic loads. Dropped cross-term amplitude bounds: ${JSON.stringify(partition.dropped)}; these are not measured omitted energy or waveform-error bounds.`] }
}
