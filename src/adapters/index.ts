/**
 * adapters — the `/node` entry. The only module allowed to import node:*.
 * Owns: createNativeSolver (ngspice temp workdir lifecycle, execFile, timeout, output collection)
 * and loadIbisSources (traversal-safe fs reads).
 * Imports: kernel, solver (types), buffers (IbisSources), board (CircuitJson).
 * Package export "./node" points straight here — no src/node.ts pass-through.
 */
export { createNativeSolver, type NativeSolverOptions } from './native-solver'
export { loadIbisSources } from './ibis-fs'
