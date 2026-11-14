import { diagnostics, type DiagnosticInit } from '../kernel'

/** Codes the declarations, electrical sources, stimuli and the routed transient raise. */
const raise = diagnostics('simulation', [
  'simulation_reference', 'simulation_experiment', 'simulation_capability', 'simulation_timing', 'simulation_scope', 'simulation_probe', 'simulation_start', 'simulation_duration', 'native_declaration', 'native_solver', 'channel_short', 'channel_net', 'channel_fanout', 'channel_model', 'ibis_model', 'ibis_mapping', 'ibis_state', 'ibis_contract', 'stimulus_pattern', 'stimulus_coverage', 'stimulus_duplicate', 'stimulus_state', 'stimulus_missing', 'probe_reference', 'electrical_input', 'supply_reference', 'supply_short', 'supply_missing', 'source_edge', 'source_capability', 'passive_reference', 'passive_capability', 'floating_source',
] as const)
export type SimulationCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(code: SimulationCode, text: string, init?: DiagnosticInit): never {
  return raise(code, text, init)
}
