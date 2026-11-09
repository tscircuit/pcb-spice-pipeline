import type { FileMap } from '../kernel'
import type { CircuitJson, ChannelGeometry } from '../board'
import type { ChannelMatrices } from '../extraction'
import type { RunSolver } from '../solver'
import type { IbisSources, AssemblyEntry } from '../buffers'
import type { SimulationPlan, VoltageProbePlan } from '../simulation'
import type { NumericalSettings } from './modeling'

export interface PreparedOptions {
  circuitJson: CircuitJson
  modeling: NumericalSettings
  ibisSources: IbisSources
  runSolver: RunSolver
  onProgress?: (message: string) => void
}

/** One PipelineResult.experiments[] entry. Field set and serialized key order are today's. */
export interface ExperimentResult {
  plan: SimulationPlan
  waveform: { timeUnit: 's'; voltageUnit: 'V'; rows: number[][] }
  simulationExperimentId: string
  name: string
  /** `experiments/<simulationExperimentId>`. */
  directory: string
  durationSeconds: number
  startTimeSeconds: number
  maxStepSeconds: number
  probes: VoltageProbePlan[]
  solverInvocations: number
  waveformSamples: number
  assembly: AssemblyEntry[]
  /** `experiments/<id>/native-ibis-assembly.json`. */
  assemblyFile: string
}

/** Designed explicitly (was Awaited<ReturnType<typeof runPipeline>>). Same field names, order and shapes as today. */
export interface PreparedResult {
  idleVoltages?: number[]
  circuitJson: CircuitJson
  modeling: NumericalSettings
  geometry: ChannelGeometry
  matrices: ChannelMatrices
  experiments: ExperimentResult[]
  limitations: string[]
  /** Sealed ledger: sorted keys, byte-identical for identical inputs + solver outputs. */
  files: FileMap
}

/** Circuit JSON is the only electrical input; sources and solver are IO ports. */
export interface PipelineOptions {
  circuitJson: CircuitJson
  ibisSources: IbisSources
  runSolver: RunSolver
  onProgress?: (message: string) => void
}
export interface BlockResult {
  duration_s: number
  simulationSignalIntegrityId: string
  name: string
  geometry: ChannelGeometry
  matrices: ChannelMatrices
  experiments: ExperimentResult[]
  numericalSettings: NumericalSettings
  results: import('../board').SignalResult[]
  limitations: string[]
}
export interface PipelineResult {
  circuitJson: CircuitJson
  simulationResultCircuitJson: CircuitJson
  blocks: BlockResult[]
  geometry?: ChannelGeometry
  matrices: ChannelMatrices
  experiments: ExperimentResult[]
  limitations: string[]
  files: FileMap
}
