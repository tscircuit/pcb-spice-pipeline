import type { LaneMapping, RoutedPoint } from './types'
import { fail } from '../diagnostics'

/** Join degree-two copper paths; retain internal pin positions for exact taps in the uniform pi model. */
export function joinSeriesMappings(mappings: LaneMapping[]): LaneMapping[] {
  const adjacent = new Map<string, LaneMapping[]>()
  for (const mapping of mappings) for (const id of [mapping.from, mapping.to]) adjacent.set(id, [...adjacent.get(id) ?? [], mapping])
  if ([...adjacent.values()].some(edges => edges.length > 2)) fail('route_selection', 'Branched copper cannot be represented as a series channel')
  const used = new Set<LaneMapping>()
  const result: LaneMapping[] = []
  for (const seed of mappings) {
    if (used.has(seed)) continue
    const connected = new Set([seed.from])
    for (const id of connected) for (const edge of adjacent.get(id)!) {
      connected.add(edge.from)
      connected.add(edge.to)
    }
    const ends = [...connected].filter(id => adjacent.get(id)!.length === 1)
    if (ends.length !== 2) fail('route_selection', 'Closed copper cycles are unsupported')
    const start = ends.find(id => adjacent.get(id)![0].from === id) ?? ends[0]
    const parts: LaneMapping[] = []
    const route: RoutedPoint[] = []
    const taps: { sourcePortId: string; lengthMm: number }[] = []
    let end = start
    let length = 0
    for (;;) {
      const next = adjacent.get(end)!.find(edge => !used.has(edge))
      if (!next) break
      used.add(next)
      const forward = next.from === end
      const points = forward ? next.originalRoute : [...next.originalRoute].reverse().map(point => point.route_type === 'via' ? { ...point, from_layer: point.to_layer, to_layer: point.from_layer } : point)
      route.push(...points.slice(route.length ? 1 : 0))
      parts.push(next)
      length += next.stages.reduce((sum, stage) => sum + stage.lengthMm, 0)
      end = forward ? next.to : next.from
      if (adjacent.get(end)!.length === 2) taps.push({ sourcePortId: end, lengthMm: length })
    }
    if (parts.length === 1) {
      result.push(seed)
      continue
    }
    result.push({ ...parts[0], from: start, to: end, originalRoute: route,
      sourceTraceIds: parts.map(part => part.sourceTraceId), pcbTraceId: parts.map(part => part.pcbTraceId).join('+'),
      pcbPorts: [parts[0].pcbPorts[parts[0].from === start ? 0 : 1], parts.at(-1)!.pcbPorts[parts.at(-1)!.to === end ? 1 : 0]],
      stages: parts.flatMap(part => part.stages), intermediatePorts: taps.map(tap => ({ sourcePortId: tap.sourcePortId, fraction: tap.lengthMm / length })) })
  }
  return result
}
