export type FileMap = Record<string, string>;
export type Solver = 'fasthenry' | 'fastercap' | 'ngspice';
export interface SolverRequest {
    solver: Solver;
    /** Paths relative to the solver's isolated working directory. */
    files: FileMap;
    args: string[];
    outputFiles: string[];
}
export interface SolverResult {
    stdout: string;
    stderr: string;
    files: FileMap;
    exitCode?: number;
}
/** Reject on an unsuccessful exit. The pipeline also validates diagnostics and outputs. */
export type RunSolver = (request: SolverRequest) => Promise<SolverResult>;
export declare function jsonFile(files: FileMap, path: string, value: unknown): void;
export declare function executeSolver(runSolver: RunSolver, artifacts: FileMap, directory: string, request: SolverRequest): Promise<SolverResult>;
