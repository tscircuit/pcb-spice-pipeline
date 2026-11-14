/**
 * simulation — experiments as declared on the board, the routed deck, and running it in ngspice.
 * Owns: SimulationPlan declaration from simulation_* records (timing, probes, stimuli, pin
 * states), electrical node mapping + ideal sources/passives, the converter run definition per
 * model, the routed ladder/network deck (RouteBindingsSolver, RouteNetworkSolver) and the live
 * transient (RouteTransientSolver).
 * Artifacts: electrical-node-map.json, simulation.cir, evidence.json and the transient capture.
 * Imports: kernel, solver, board, extraction, observation, buffers.
 */
export type { SimulationModeling, CircuitNodes, PipelineIbisModel, VoltageProbePlan, SimulationPlan, Declarations, ElectricalSources } from './types'
export { circuitNodes, generalDeclarations, modelRunDefinition } from './declarations'
export { namespaceSpice, electricalSources } from './netlist'
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

export { routeWaveformDrawing, receiverThreshold, roundStep, roundTicks, type WaveformProbe, type WaveformState, type ReceiverThreshold } from './waveform-visual'
