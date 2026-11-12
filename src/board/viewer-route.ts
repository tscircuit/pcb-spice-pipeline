import type { CircuitJson } from './schema'
import type { BoardStackup } from './stackup'
import { resolveRouteVias } from './geometry/ports'
import { boardPosition, type BoardPosition } from './viewer-geometry'

export interface BoardRouteSegment {
  trace: string
  layer: string
  toLayer: string
  kind: 'wire' | 'via'
  a: BoardPosition
  b: BoardPosition
  width: number
  thickness: number
  start: number
  end: number
}

/** Retain each PCB trace's physical arc length, copper thickness and explicit vertical via segments. */
export function boardRouteSegments(circuit: CircuitJson, stack: BoardStackup): BoardRouteSegment[] {
  return circuit
    .filter((record) => record.type === 'pcb_trace')
    .flatMap((trace) => {
      const result: BoardRouteSegment[] = []
      const route = resolveRouteVias(circuit, trace)
      let distance = 0
      /** Append real geometry only; zero-length route records do not become electrical length. */
      const add = (
        a: BoardPosition,
        b: BoardPosition,
        layer: string,
        toLayer: string,
        width: number,
        thickness: number,
        kind: 'wire' | 'via',
      ): void => {
        const length = Math.hypot(...a.map((value, axis) => value - b[axis]))
        if (length < 1e-9) return
        result.push({ trace: trace.pcb_trace_id, layer, toLayer, kind, a, b, width, thickness, start: distance, end: distance + length })
        distance += length
      }
      for (const [i, b] of route.entries()) {
        if (i) {
          const a = route[i - 1]
          const layer = b.route_type === 'via' ? b.from_layer : b.layer
          const copper = stack.copperLayers.find((entry) => entry.name === layer)!
          add(
            boardPosition(stack, a.x, a.y, layer),
            boardPosition(stack, b.x, b.y, layer),
            layer,
            layer,
            b.route_type === 'wire' ? b.width : 0.2,
            copper.zMaxMm - copper.zMinMm,
            'wire',
          )
        }
        if (b.route_type === 'via')
          add(
            boardPosition(stack, b.x, b.y, b.from_layer),
            boardPosition(stack, b.x, b.y, b.to_layer),
            b.from_layer,
            b.to_layer,
            b.outer_diameter ?? 0.3,
            stack.viaPlatingMm ?? 0.018,
            'via',
          )
      }
      return result
    })
}
