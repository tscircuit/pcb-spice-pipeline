/** Browser-only entry: the worker owns the WASM engine and is terminated after each run. */
export { createWasmSolver, type WasmSolverOptions, type SpiceWorker } from './wasm-solver'
