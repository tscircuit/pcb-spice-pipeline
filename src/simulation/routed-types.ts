import type { CircuitJson, CopperScope, LaneMapping, SectionGeometry } from '../board'
import type { CompiledBuffer, IbisSources } from '../buffers'
import type { ExtractedRoutes, RouteMaterials, RouteReturn } from '../extraction'
import type { AcceptedRun } from '../solver'
import type { SimulationModeling, SimulationPlan, VoltageProbePlan } from './types'

export interface RoutedCompileOptions {
  riseSeconds: number
  refinement: number
  durationSeconds: number
  stepSeconds: number
  panels?: number
  currentToleranceA?: number
  cellsPerRise?: number
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
/** Result from the existing execution port; no browser replay format. */
export interface RoutedExecution {
  requestSha256: string
  run: AcceptedRun<'waveform.dat'>
}
export type RoutedCapture = { kind: 'not-run' } | {
  kind: 'completed'
  qualification: 'candidate-unqualified'
  timestampsSeconds: number[]
  probes: { name: string; sourcePortId: string; voltageLevels: number[] }[]
}
