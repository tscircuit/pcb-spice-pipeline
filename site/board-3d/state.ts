import { connectedSourceIds, type CircuitJson } from '../../src/board'
import type { RoutedBindings, RouteSpatialWaveform, RouteVoltageRange } from '../../src/simulation'
export { routedScene as boardStageState, type RoutedSceneState as BoardStageState } from '../../src/pipeline'

/** Interpolate only in time between actual saved native samples. */
export function spatialVoltage(waveform: RouteSpatialWaveform, point: number, time: number): number | undefined {
  const values = waveform.volts[point]
  const times = waveform.timeSeconds
  if (!values?.length || values.length !== times.length) return undefined
  if (time <= times[0]) return values[0]
  const after = times.findIndex((value) => value >= time)
  if (after < 0) return values.at(-1)
  const before = after - 1
  const fraction = (time - times[before]) / (times[after] - times[before])
  return values[before] + (values[after] - values[before]) * fraction
}

/** One colour scale fitted to the captured probe range, shared by every net and time. */
export function voltageColor(voltage: number, range: RouteVoltageRange): string {
  const fraction = Math.min(1, Math.max(0, (voltage - range.low) / (range.high - range.low)))
  return `hsl(${240 * (1 - fraction)}, 90%, 50%)`
}

/** Associate producer net labels with copper through electrical node identity, including differential leg labels. */
export function spatialRouteIndices(
  circuit: CircuitJson,
  bindings: Pick<RoutedBindings, 'nodeMap'>[],
  waveform: RouteSpatialWaveform,
  traceId: string,
): number[] {
  const trace = circuit.find((record) => record.type === 'pcb_trace' && record.pcb_trace_id === traceId)
  const source =
    trace?.type === 'pcb_trace' &&
    circuit.find((record) => record.type === 'source_trace' && record.source_trace_id === trace.source_trace_id)
  const aliases = new Set([traceId])
  if (source && source.type === 'source_trace') {
    aliases.add(source.source_trace_id)
    const connected = connectedSourceIds(
      circuit,
      source.connected_source_port_ids[0] ?? source.connected_source_net_ids?.[0] ?? source.source_trace_id,
    )
    const nodes = new Set(bindings.flatMap((binding) => [...connected].flatMap((id) => (binding.nodeMap[id] ? [binding.nodeMap[id]] : []))))
    for (const point of waveform.points) if (nodes.has(point.node)) aliases.add(point.net)
    for (const net of circuit.filter((record) => record.type === 'source_net')) {
      if (!connected.has(net.source_net_id)) continue
      aliases.add(net.name)
      aliases.add(net.source_net_id)
    }
  }
  return waveform.points.flatMap((point, index) => (aliases.has(point.net) ? [index] : []))
}
