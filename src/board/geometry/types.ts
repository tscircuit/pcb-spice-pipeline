import type { CircuitJson } from '../schema'
import type { BoardStackup } from '../stackup'

export type PortSelector = { sourcePortId: string; component?: never; port?: never } | { sourcePortId?: never; component: string; port: string }
export interface LaneModeling { port: string; from: PortSelector; to: PortSelector; sourceTraceId?: string }
/** Only electrical intent belongs in modeling; construction belongs in pcb_stackup. */
export interface BoardModeling { lanes: LaneModeling[]; description?: string }
export type Modeling = BoardModeling
export type SourcePort = Extract<CircuitJson[number], { type: 'source_port' }>
export type PcbTrace = Extract<CircuitJson[number], { type: 'pcb_trace' }>
export type RoutePoint = PcbTrace['route'][number]
export type RoutedPoint = Exclude<RoutePoint, { route_type: 'through_pad' }>
export type CopperPoint = [number, number]
export type CopperXYZ = [number, number, number]
export type CopperPolygon = CopperPoint[][]
export interface RouteStage { kind: 'wire' | 'via'; profile: string; lengthMm: number; widthMm: number; thicknessMm: number }
export interface LaneMapping {
  port: string; sourceTraceId: string; pcbTraceId: string; from: string; to: string
  pcbPorts: string[]; stages: RouteStage[]; originalRoute: RoutedPoint[]
}
/** Rectangles in the transverse (x,z) plane, in millimetres. The ground is group -1. */
export interface SliceConductor {
  id: string; group: number; xMin: number; xMax: number; zMin: number; zMax: number; conductivitySm: number
}
export interface SliceDielectric { xMin: number; xMax: number; zMin: number; zMax: number; er: number; lossTangent: number }
export interface CrossSection { activeCount?: number; conductors: SliceConductor[]; dielectrics: SliceDielectric[] }
export interface SegmentPort { lane: string; from: string; to: string }
export interface ViaModel { holeMm: number; padMm: number; antipadMm: number; platingMm: number; lengthMm: number; er: number; conductivitySm: number }
export interface GeometryCell {
  stage: number; profile: string; lengthM: number; ports: SegmentPort[]
  start: CopperPoint; end: CopperPoint; slice?: CrossSection; via?: ViaModel
}
export interface Geometry {
  stackup: BoardStackup; cells: GeometryCell[]; mappings: LaneMapping[]; groundSourcePortId: string
  units: { circuitJson: 'mm'; geometry: 'm'; conductivity: 'S/m' }; approximations: string[]
}
export type ChannelGeometry = Geometry
