import { fail } from './matrices.mjs'

export type FileMap = Record<string, string>
export type Solver = 'fasthenry' | 'fastercap' | 'ngspice'
export interface SolverRequest {
  solver: Solver
  /** Paths relative to the solver's isolated working directory. */
  files: FileMap
  args: string[]
  outputFiles: string[]
}
export interface SolverResult { stdout: string; stderr: string; files: FileMap }
/** Reject on an unsuccessful exit. The pipeline also validates diagnostics and outputs. */
export type RunSolver = (request: SolverRequest) => Promise<SolverResult>

export function jsonFile(files: FileMap, path: string, value: unknown): void {
  files[path] = JSON.stringify(value, null, 2) + '\n'
}

export async function executeSolver(runSolver: RunSolver, artifacts: FileMap, directory: string, request: SolverRequest): Promise<SolverResult> {
  const supplied = { ...request.files }
  const result = await runSolver({ ...request, files: { ...supplied }, args: [...request.args], outputFiles: [...request.outputFiles] })
  if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || !result.files || typeof result.files !== 'object')
    fail('solver_result', `${request.solver}: expected stdout, stderr and files`)
  for (const file of request.outputFiles) if (!Object.hasOwn(result.files, file) || typeof result.files[file] !== 'string')
    fail('native_output', `${request.solver}: missing ${file}`)
  for (const [path, body] of Object.entries({ ...supplied, ...result.files })) {
    if (typeof body !== 'string') fail('solver_result', `${request.solver}: ${path} must be a string`)
    artifacts[`${directory}/${path}`] = body
  }
  artifacts[`${directory}/${request.solver}.stdout.log`] = result.stdout
  artifacts[`${directory}/${request.solver}.stderr.log`] = result.stderr
  jsonFile(artifacts, `${directory}/${request.solver}.request.json`, request)
  return result
}
