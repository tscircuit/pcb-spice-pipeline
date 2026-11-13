import type { CircuitJson, CopperScope, LaneMapping, SectionGeometry } from '../board'
import type { CompiledBuffer, IbisSources } from '../buffers'
import type { ExtractedRoutes, RouteMaterials, RouteReturn } from '../extraction'
import type { SimulationModeling, SimulationPlan, VoltageProbePlan } from './types'

export interface RoutedCompileOptions {
  riseSeconds: number
  refinement: number
  durationSeconds: number
  stepSeconds: number
  panels?: number
  currentToleranceA?: number
  cellsPerRise?: number
  /** Research opt-in: realize series inductance by L⁻¹ truncated at this relative magnitude, instead of K lines. */
  susceptanceThreshold?: number
  materials?: RouteMaterials
  returnPath?: RouteReturn
}
export interface RouteBindingsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  mappings: LaneMapping[]
  modeling: SimulationModeling
  ibisSources: IbisSources
  options: RoutedCompileOptions
  artifactPrefix: string
}
export type RouteBuffer = Pick<CompiledBuffer, 'name' | 'source' | 'spicePinMapping' | 'metadata' | 'warnings' | 'sourceEvidence'>
export interface RoutedBindings {
  circuitJson: CircuitJson
  scope: CopperScope
  mappings: LaneMapping[]
  plan: SimulationPlan
  nodeMap: Record<string, string>
  groundSourcePortId: string
  electricalLines: string[]
  models: RouteBuffer[]
}
export interface RouteNetworkInput {
  blockId: string
  name: string
  geometry: SectionGeometry
  extracted: ExtractedRoutes
  bindings: RoutedBindings
  materials: RouteMaterials
  options: RoutedCompileOptions
  warnings: string[]
  artifactPrefix: string
}
export interface RoutedDeck {
  blockId: string
  name: string
  deck: string
  requestSha256: string
  probes: VoltageProbePlan[]
  durationSeconds: number
  stepSeconds: number
  evidence: Record<string, unknown>
}
/** A completed live transient; failures never expose a partial capture. */
export interface RoutedCapture {
  kind: 'completed'
  qualification: 'candidate-unqualified'
  timestampsSeconds: number[]
  probes: { name: string; sourcePortId: string; voltageLevels: number[] }[]
}
