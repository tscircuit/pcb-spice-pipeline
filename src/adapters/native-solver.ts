import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RunSolver, Solver, SolverRequest, SolverResult } from '../solver'
import { fail } from './diagnostics'
import { contained, relativeFile } from './paths'

export interface NativeSolverOptions { tools?: Partial<Record<Solver, string>>; timeoutMs?: number }
const exec = promisify(execFile)
let nativeTail: Promise<void> = Promise.resolve()

/**
 * Executes only requests passed by the caller; never installs or downloads tools.
 * Lifecycle: validate -> mkdtemp -> write -> spawn -> collect, with rm in `finally`.
 * Cleanup runs on every path (finally). Collects only requested outputFiles, each contained in the workdir.
 */
export function createNativeSolver({ tools = {}, timeoutMs = 900000 }: NativeSolverOptions = {}): RunSolver {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail('native_timeout', 'timeoutMs must be a positive integer')
  /** Execute one request after the shared native queue grants its slot. */
  const run = async (request: SolverRequest): Promise<SolverResult> => {
    if (request.solver !== 'ngspice') fail('native_solver', 'Unknown solver')
    for (const path of [...Object.keys(request.files), ...request.outputFiles]) relativeFile(path)
    const directory = await mkdtemp(join(tmpdir(), 'pcb-spice-'))
    try {
      for (const [path, body] of Object.entries(request.files)) {
        const target = join(directory, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, body)
      }
      let run: { stdout: string; stderr: string }
      try {
        run = await exec(tools.ngspice ?? 'ngspice', request.args,
          { cwd: directory, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: '1', SPICE_ASCIIRAWFILE: '1' } })
      } catch (error) {
        const detail = error as Error & { code?: string | number | null; killed?: boolean; signal?: string; stdout?: string; stderr?: string }
        // execFile's timeout kills with SIGTERM and no exit code. External
        // signals are not marked killed; maxBuffer errors have a string code.
        const timedOut = detail.killed && detail.signal === 'SIGTERM' && detail.code === null
        fail(timedOut ? 'native_timeout' : 'native_solver', `${request.solver}: ${timedOut ? `exceeded ${timeoutMs} ms process timeout; ${detail.message}` : detail.message}\n${detail.stdout ?? ''}\n${detail.stderr ?? ''}`)
      }
      const files: Record<string, string> = Object.create(null)
      const root = await realpath(directory)
      for (const path of request.outputFiles) {
        try {
          files[path] = await readFile(contained(root, await realpath(join(directory, path))), 'utf8')
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          // The pipeline validates required outputs and solver diagnostics.
        }
      }
      return { ...run, files }
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
  return async request => {
    const previous = nativeTail
    let release!: () => void
    nativeTail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      return await run(request)
    }
    finally { release() }
  }

}
