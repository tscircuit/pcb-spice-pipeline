import { diagnostics, type DiagnosticInit } from '../kernel'

const raise = diagnostics('board', [
  'oblique_coupling', 'varying_cross_section', 'reference_via', 'circuit_schema', 'conductor_overlap', 'endpoint_position', 'ground_geometry', 'ground_net', 'ground_reference', 'lanes', 'layer_transition', 'modeling_input', 'pin_mapping', 'route_branch', 'route_selection', 'route_type', 'simulation_scope', 'slice_conductor', 'slice_ground', 'stackup', 'stackup_conductivity', 'stackup_loss', 'stackup_permittivity', 'varying_width', 'via_antipad', 'via_geometry', 'via_plating'
] as const)
export type BoardCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(code: BoardCode, text: string, init?: DiagnosticInit): never {
  return raise(code, text, init)
}
