import { diagnostics, type DiagnosticInit } from '../kernel'

const raise = diagnostics('board', [
  'circuit_schema', 'pin_mapping', 'route_type', 'stackup', 'via_geometry', 'simulation_scope',
] as const)
export type BoardCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(code: BoardCode, text: string, init?: DiagnosticInit): never {
  return raise(code, text, init)
}
