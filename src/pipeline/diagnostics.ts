import { diagnostics, type DiagnosticInit } from '../kernel'
// Public signal-integrity input diagnostics.
const raise = diagnostics('pipeline', ['signal_integrity_input'] as const)
export type PipelineCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(code: PipelineCode, text: string, init?: DiagnosticInit): never {
  return raise(code, text, init)
}
