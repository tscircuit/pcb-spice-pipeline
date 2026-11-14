// Declaration and plan shapes the routed bindings and deck consume.
import type { CircuitJson, PortSelector, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus } from '../board'

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
/** Today's generalDeclarations return value. `models` holds only models some plan uses, in declaration order. */
export interface Declarations {
  models: PipelineIbisModel[]
  nodes: CircuitNodes
  plans: SimulationPlan[]
  ports: Map<string, Extract<CircuitJson[number], { type: 'source_port' }>>
}

export interface ElectricalSources {
  lines: string[]
  activeNodes: Set<string>
  grounded: Set<string>
  sourceBindings: Array<{ name: string; positiveNode: string; negativeNode: string }>
  scope: { voltageSources: number; passiveComponents: number; unselectedBoardComponents: string }
}
