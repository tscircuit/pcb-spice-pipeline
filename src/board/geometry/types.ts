// Port selectors, lane mappings and routed copper shapes shared by board admission and the routed stages.
import type { CircuitJson } from '../schema'

export type PortSelector = { sourcePortId: string; component?: never; port?: never } | { sourcePortId?: never; component: string; port: string }
export interface LaneModeling { port: string; from: PortSelector; to: PortSelector; sourceTraceId?: string }
export type SourcePort = Extract<CircuitJson[number], { type: 'source_port' }>
export type PcbTrace = Extract<CircuitJson[number], { type: 'pcb_trace' }>
export type RoutePoint = PcbTrace['route'][number]
export type RoutedPoint = Exclude<RoutePoint, { route_type: 'through_pad' }>

/** One driver-to-receiver physical signal; `sourceTraceIds` lists every trace cut out of ideal connectivity. */
export interface LaneMapping {
  port: string; sourceTraceId: string; from: string; to: string
  sourceTraceIds?: string[]
}

/** Copper outlines in mm. */
export type CopperPoint = [number, number]
export type CopperPolygon = CopperPoint[][]
