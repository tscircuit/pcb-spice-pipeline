// Root entry: pure (no node:*). Re-exports module surfaces only (check-modules S5).
export { runPipeline } from './pipeline'
export type { PipelineOptions, PipelineResult, PipelineBlockResult, BlockResult } from './pipeline'
export type { Solver, SolverRequest, SolverResult, RunSolver } from './solver'
export type { FileMap, Diagnostic, DiagnosticSubject } from './kernel'
export type { DiagnosticCode } from './modules.generated'
export type { IbisSources } from './buffers'
export { generateReport } from './report'
export type { CircuitJson } from './board'
export { stackupFromCircuitJson } from './board'
export { transmittedBits } from './simulation'

export { RoutedPipelineSolver } from './pipeline'
export type { RoutedProblem, RoutedInspection } from './pipeline'
export { RouteTransientSolver } from './simulation'

export type { RouteSpatialPoint, RouteSpatialWaveform } from './simulation'
