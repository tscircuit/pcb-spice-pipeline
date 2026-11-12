/** Derives independent signal-integrity runs from Circuit JSON. */
export { runPipeline } from './run'
export type { PipelineOptions, PipelineResult, PipelineBlockResult, BlockResult, ExperimentResult } from './result'
export type { NumericalSettings } from './modeling'
export { RoutedPipelineSolver, RoutedBlockSolver, routedStages, type RoutedInspection, type RoutedBlockView } from './routed-pipeline'
export { RoutedAdmissionSolver, type RoutedProblem } from './routed-admission'
