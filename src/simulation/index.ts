/**
 * simulation — experiments as declared on the board, and running them in ngspice.
 * Owns: SimulationPlan declaration from simulation_* records (timing, probes, stimuli, pin
 * states), electrical node mapping + ideal sources/passives, the converter run
 * definition per model, probe-scope validation, the experiment netlist, ngspice diagnostics,
 * waveform coverage checks, and simulation_transient_voltage_graph result records.
 * Order (today's runPipeline): generalDeclarations -> electricalSources -> safeSimulationPlans
 * -> [buffers compile with modelRunDefinition] -> bindExperiments -> [extraction] -> runExperiment per plan.
 * Artifacts: electrical-node-map.json, experiments/<id>/{experiment.json, <model>.lib, simulation.cir,
 * ngspice.*, waveform.dat, waveform.csv, waveform.json}.
 * Imports: kernel, solver, board, extraction, observation, buffers (types).
 * (Was: declarations.ts, general-spice.ts, stimulus.ts, ngspice part of general-pipeline.ts.)
 */
export type {
  SimulationModeling, CircuitNodes, PipelineIbisModel, VoltageProbePlan, SimulationPlan, SafeSimulationPlan,
  Declarations, ElectricalModel, CompiledModel, ExperimentModel, ElectricalSources, SimulationSpiceOptions,
  Experiments, BoundExperiments, ExperimentRun, ExperimentResult,
} from './types'
export { circuitNodes, generalDeclarations, modelRunDefinition } from './declarations'
export { namespaceSpice, electricalSources, simulationSpiceOptions, generalSimulationSpice, validateProbeScope } from './netlist'
export { safeSimulationPlans, electricalNodeMap, bindExperiments, runIdle, runExperiment, experimentResult } from './run'
export { transmittedBits } from './stimulus'
export { routeLadder, type RouteLadder } from './route-ladder'
export { routeTransitions, terminalInductance, barrelInductance, barrelCapacitance, type RouteTransitions } from './route-transitions'
export { routeOblique } from './route-oblique'
export { branchSaves } from './branch-saves'

export { routedControl } from './routed-control'

export { RouteBindingsSolver } from './route-bindings'
export { RouteNetworkSolver } from './route-network'
export { RouteTransientSolver } from './route-transient'
export type { RoutedCompileOptions, RouteBindingsInput, RoutedBindings, RouteNetworkInput, RoutedDeck, RoutedCapture } from './routed-types'

export { routeWaveformDrawing } from './waveform-visual'

export { routeGraph, routePartitions, partitionNetworkInput } from './route-partition'
export type { RouteNet, RoutePair, RouteGraph, RoutePartition } from './route-partition'
