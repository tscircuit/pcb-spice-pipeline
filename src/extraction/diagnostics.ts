import { diagnostics, type DiagnosticInit } from '../kernel'

const raise = diagnostics('extraction', [
  'model_frequency', 'loss_fit',   'matrix_dimension', 'matrix_format', 'matrix_singular', 'matrix_storage', 'matrix_backend', 'matrix_zero', 'mesh_convergence', 'passivity', 'reciprocity'
] as const)
export type ExtractionCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(code: ExtractionCode, text: string, init?: DiagnosticInit): never {
  return raise(code, text, init)
}
