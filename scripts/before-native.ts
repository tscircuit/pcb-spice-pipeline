// BEFORE evidence only: no harness deadline or output-buffer cap.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SolverRequest, SolverResult } from '../src/solver'

const execute = promisify(execFile)
const tools = { fasthenry:'/opt/homebrew/bin/fasthenry', fastercap:'/opt/homebrew/bin/FasterCap', ngspice:'/opt/homebrew/bin/ngspice' }
/** Executes the old extractor's requests while retaining every requested output and native error. */
export async function beforeNative(request: SolverRequest): Promise<SolverResult> {
  for (const path of [...Object.keys(request.files), ...request.outputFiles])
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw Object.assign(Error(`native_path: ${path}`), { code:'native_path' })
  if (!tools[request.solver]) throw Object.assign(Error(`native_solver: ${request.solver}`), { code:'native_solver' })
  const directory = await mkdtemp(join(tmpdir(), 'si-before-'))
  try {
    for (const [path, body] of Object.entries(request.files)) {
      await mkdir(dirname(join(directory, path)), { recursive:true })
      await writeFile(join(directory, path), body)
    }
    let output: { stdout:string; stderr:string }
    try {
      output = await execute(tools[request.solver], request.args, { cwd:directory, maxBuffer:Infinity })
    } catch (error) {
      const detail = error as Error & { stdout?:string; stderr?:string }
      throw Object.assign(Error(`native_solver: ${detail.message}\n${detail.stdout??''}\n${detail.stderr??''}`), { code:'native_solver' })
    }
    const files: Record<string,string> = {}
    for (const path of request.outputFiles) files[path] = await readFile(join(directory, path), 'utf8')
    return { ...output, files }
  } finally { await rm(directory, { recursive:true, force:true }) }
}
