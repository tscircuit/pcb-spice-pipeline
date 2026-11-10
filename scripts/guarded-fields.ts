import { spawn, execFileSync } from 'node:child_process'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SolverRequest, SolverResult } from '../src/solver'

/** Archive serial field calls under the transient lock, enforcing one thread, 1 GiB and 20 minutes.
 * A lower field deadline bounds calls without observable solver progress.
 */
export async function guardedFields(request: SolverRequest, directory: string): Promise<SolverResult> {
  const limit = Number(process.env.SI_FIELD_LIMIT_SECONDS ?? 240)
  if (!(limit > 0 && limit <= 1200)) throw new Error('Field deadline must be in (0,1200] seconds')
  const lockPath = resolve('runs/routed-2d/ngspice.lock')
  await mkdir('runs/routed-2d', { recursive: true })
  const lock = await open(lockPath, 'wx')
  let peak = 0
  const start = performance.now()
  try {
    if (execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' }).split('\n').some(line => /(?:^|\/)(?:ngspice|fasthenry|fastercap)$/i.test(line.trim()))) throw new Error('Another native solver is running')
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/request.json`, JSON.stringify(request))
    for (const [file, body] of Object.entries(request.files)) await writeFile(`${directory}/${file}`, body)
    let stdout = ''
    let stderr = ''
    await new Promise<void>((accept, reject) => {
      const child = spawn(`/opt/homebrew/bin/${request.solver === 'fastercap' ? 'FasterCap' : request.solver}`, request.args, { cwd: directory, env: { ...process.env, OMP_NUM_THREADS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let reason = ''
      /** Stop immediately on the sampled memory or elapsed budget. */
      const monitor = setInterval(() => {
        if (!child.pid) return
        let rss = 0
        try {
          rss = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim())
        } catch { /* Child exited. */ }
        peak = Math.max(peak, rss)
        if (peak > 768 * 1024 || performance.now() - start > limit * 1000) {
          reason = peak > 768 * 1024 ? 'Field solver reached the 768 MiB safety stop below the 1 GiB limit' : 'Field solver exceeded bounded deadline'
          child.kill('SIGKILL')
        }
      }, 100)
      child.stdout.on('data', chunk => {
        stdout += String(chunk)
      })
      child.stderr.on('data', chunk => {
        stderr += String(chunk)
      })
      child.on('error', error => {
        clearInterval(monitor)
        reject(error)
      })
      child.on('close', code => {
        clearInterval(monitor)
        code || reason ? reject(new Error(reason || `Field solver exited ${code}`)) : accept()
      })
    }).finally(async () => {
      await writeFile(`${directory}/stdout.log`, stdout)
      await writeFile(`${directory}/stderr.log`, stderr)
      await writeFile(`${directory}/usage.json`, JSON.stringify({ seconds: (performance.now() - start) / 1000, peakRssKiB: peak }))
    })
    return { stdout, stderr, files: Object.fromEntries(await Promise.all(request.outputFiles.map(async file => [file, await readFile(`${directory}/${file}`, 'utf8')])) ) }
  } finally {
    await lock.close()
    await rm(lockPath)
  }
}
