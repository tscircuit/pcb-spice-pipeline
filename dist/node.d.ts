import type { CircuitJson } from './schema.js';
import type { PipelineResult } from './general-pipeline.js';
import type { RunSolver, Solver } from './solver.js';
import { type IbisSources } from './model-source.js';
export interface NativeSolverOptions {
    tools?: Partial<Record<Solver, string>>;
    timeoutMs?: number;
}
/** Executes only requests passed by the caller; never installs or downloads tools. */
export declare function createNativeSolver({ tools, timeoutMs }?: NativeSolverOptions): RunSolver;
/** Load declared local files only. Asset URLs do not trigger downloads. */
export declare function loadIbisSources({ circuitJson, baseDir }: {
    circuitJson: CircuitJson;
    baseDir: string;
}): Promise<IbisSources>;
/** Write the supplied result and a report at the caller's explicit request. */
export declare function writePipelineOutput({ result, outputDir }: {
    result: PipelineResult;
    outputDir: string;
}): Promise<void>;
