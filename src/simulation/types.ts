// Today's declaration/plan shapes (was declarations.ts + general-spice.ts types). Serialized into
// experiments/<id>/experiment.json and PipelineResult.experiments[].plan: do not reorder or rename.
import type { IbisConversionMetadata } from '@tscircuit/ibis-to-spice'
import type { SafeId } from '../kernel'
import type { CircuitJson, PortSelector, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus } from '../board'
import type { WaveformRows } from '../observation'

/** simulation's slice of the flat public `Modeling`. (`channelReference` is shared with board's slice.) */
export interface SimulationModeling {
  channelReference?: PortSelector
  supplies?: { positive: PortSelector; negative: PortSelector; voltageV: number }[]
  passiveComponents?: { sourceComponentId?: string; component?: string }[]
}

export interface CircuitNodes {
  node(id: string): string
  groundSourcePortId: string
  mapping: Record<string, string>
}
export type PipelineIbisModel = SimulationIbisModel & { pipelineId: string }
export interface VoltageProbePlan {
  simulationVoltageProbeId: string
  name: string
  column: number
  signalSourceId: string
  referenceSourceId: string | null
  signalNode: string
  referenceNode: string
}
export interface SimulationPlan {
  simulationExperimentId: string
  name: string
  subcircuitId: string | null
  durationSeconds: number
  startTimeSeconds: number
  maxStepSeconds: number
  experiment: SimulationExperiment
  states: SimulationIbisPinState[]
  stimuli: (SimulationDigitalStimulus & { transmission_pattern: { bits: string } })[]
  probes: VoltageProbePlan[]
  models: PipelineIbisModel[]
}
/** A plan with an admitted experiment artifact identifier. */
export type SafeSimulationPlan = Omit<SimulationPlan, 'simulationExperimentId'> & { simulationExperimentId: SafeId }

/** Today's generalDeclarations return value. `models` holds only models some plan uses, in declaration order. */
export interface Declarations {
  models: PipelineIbisModel[]
  nodes: CircuitNodes
  plans: SimulationPlan[]
  ports: Map<string, Extract<CircuitJson[number], { type: 'source_port' }>>
}

export interface ElectricalModel {
  name: string
  spicePinMapping: Record<string, string>
  metadata?: Pick<IbisConversionMetadata, 'pins'>
}
export interface CompiledModel extends ElectricalModel { source: string }
/** A compiled model as an experiment consumes it: `<pipelineId>.lib` is its library file name. */
export interface ExperimentModel extends CompiledModel { pipelineId: string }
export interface ElectricalSources {
  lines: string[]
  activeNodes: Set<string>
  grounded: Set<string>
  sourceBindings: Array<{ name: string; positiveNode: string; negativeNode: string }>
  scope: { voltageSources: number; passiveComponents: number; unselectedBoardComponents: string }
}
export interface SimulationSpiceOptions { reltol: number; abstol: number; method: 'gear' | 'trap'; vntol?: number }

/** Declared experiments plus their electrical model: everything before buffers compile. */
export interface Experiments extends Declarations { electrical: ElectricalSources }
declare const boundBrand: unique symbol
/** Probe scope validated against geometry + compiled models (bindExperiments). The last thing before solver work. */
export interface BoundExperiments<M extends ExperimentModel = ExperimentModel> extends Experiments {
  readonly [boundBrand]: true
  /** compiled[i] are plans[i]'s models, in plan model order. */
  readonly compiled: readonly (readonly M[])[]
}
/** One accepted ngspice run. rows = [time_s, probe columns...] (waveform.csv). */
export interface ExperimentRun {
  readonly plan: SimulationPlan
  /** `experiments/<id>`. */
  readonly directory: string
  readonly rows: number[][]
  /** SHA-256 of `<directory>/waveform.csv`, the eye descriptors' sourceSha256. */
  readonly waveformCsvSha256: string
}
/** Today's PipelineResult.experiments[] entry. Key order is serialized. */
export interface ExperimentResult<A = unknown> {
  plan: SimulationPlan
  waveform: { timeUnit: 's'; voltageUnit: 'V'; rows: number[][] }
  simulationExperimentId: string
  name: string
  directory: string
  durationSeconds: number
  startTimeSeconds: number
  maxStepSeconds: number
  probes: VoltageProbePlan[]
  solverInvocations: 1
  waveformSamples: number
  assembly: A[]
  assemblyFile: string
}
export type { WaveformRows }
