import { spawn, execFile } from 'node:child_process'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

/** Serialize native solves, bound RSS/runtime and preserve checkpoint output on failure. */
export async function routedNative(directory: string, duration: number): Promise<{ seconds: number; peakRssKiB: number }> {
  const limit = Number(process.env.SI_ROUTE_NATIVE_LIMIT_SECONDS ?? 1200)
  if (!(limit > 0 && limit <= 1200)) throw new Error('Native runtime limit must be in (0,1200] seconds')
  await mkdir('runs/routed-2d', { recursive: true })
  const path = resolve('runs/routed-2d/ngspice.lock')
  const lock = await open(path, 'wx')
  await lock.writeFile(String(process.pid))
  const start = performance.now()
  let peakRssKiB = 0
  try {
    const deck = await readFile(`${directory}/simulation.cir`, 'utf8')
    const checkpoints = [...deck.matchAll(/^echo SI_PROGRESS (.+)$/gm)].map(match => Number(match[1]))
    const processes = await promisify(execFile)('ps', ['-axo', 'comm='])
    if (processes.stdout.split('\n').some(line => /(?:^|\/)(?:ngspice|fasthenry|fastercap)$/i.test(line.trim()))) throw new Error('Another native solver is running')
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.env.NGSPICE_BIN ?? '/opt/homebrew/bin/ngspice', ['-b', '-o', 'ngspice-native.log', 'simulation.cir'], { cwd: directory, env: { ...process.env, OMP_NUM_THREADS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let log = ''
      let budgetError = ''
      let first: { wall: number; seconds: number } | undefined
      const checkpointsReached: { wall_seconds: number; simulation_seconds: number }[] = []
      let lastLogRead = 0
      let checking = false
      let force: ReturnType<typeof setTimeout> | undefined
      /** Ensure a budget stop cannot leave an unbounded native child. */
      const stop = (reason: string): void => {
        if (budgetError) return
        budgetError = reason
        child.kill('SIGTERM')
        force = setTimeout(() => child.kill('SIGKILL'), 2000)
      }
      const timer = setTimeout(() => stop(`Native runtime exceeded ${limit} s budget`), limit * 1000)
      const monitor = setInterval(async () => {
        if (checking || !child.pid) return
        checking = true
        try {
          const memory = await promisify(execFile)('ps', ['-o', 'rss=', '-p', String(child.pid)]).catch(() => ({ stdout: '0' }))
          peakRssKiB = Math.max(peakRssKiB, Number(memory.stdout.trim()) || 0)
          if (peakRssKiB > 1024 * 1024) stop('Native memory exceeded 1 GiB budget')
          if (performance.now() - lastLogRead < 1000) return
          lastLogRead = performance.now()
          const nativeLog = await readFile(`${directory}/ngspice-native.log`, 'utf8').catch(() => '')
          const progress = [...nativeLog.matchAll(/SI_PROGRESS\s+([\d.eE+-]+)/g)].map(match => Number(match[1]))
          const seconds = progress.at(-1)
          if (!(seconds && seconds > 0)) return
          const wall = (performance.now() - start) / 1000
          if (checkpointsReached.at(-1)?.simulation_seconds !== seconds) checkpointsReached.push({ wall_seconds: wall, simulation_seconds: seconds })
          first ??= { wall, seconds }
          const upper = checkpoints.find(time => time > seconds * (1 + 1e-12)) ?? duration
          const projected = first.wall + (wall - first.wall) * (duration - first.seconds) / (upper - first.seconds)
          if (wall - first.wall > 15 && projected > 1200) stop(`Projected transient ${projected.toFixed(0)} s exceeds 20 minute budget`)
        } finally {
          checking = false
        }
      }, 100)
      child.stdout.on('data', chunk => {
        log += String(chunk)
      })
      child.stderr.on('data', chunk => {
        log += String(chunk)
      })
      /** Release timers only after the native process exits. */
      const clean = (): void => {
        clearInterval(monitor)
        clearTimeout(timer)
        clearTimeout(force)
      }
      child.on('error', error => {
        clean()
        reject(error)
      })
      child.on('close', async code => {
        clean()
        log += await readFile(`${directory}/ngspice-native.log`, 'utf8').catch(() => '')
        await writeFile(`${directory}/ngspice.log`, log)
        const seconds = (performance.now() - start) / 1000
        await writeFile(`${directory}/native.json`, JSON.stringify({ seconds, peakRssKiB, code, budgetError, checkpoints: checkpointsReached }, null, 2))
        if (code !== 0 || budgetError || /timestep too small|run simulation\(s\) aborted|fatal error|out of memory/i.test(log)) reject(Object.assign(new Error(budgetError || `ngspice failed (${code}); inspect ${directory}/ngspice.log`), { nativePeakRssKiB: peakRssKiB }))
        else accept()
      })
    })
    return { seconds: (performance.now() - start) / 1000, peakRssKiB }
  } finally {
    await lock.close()
    await rm(path)
  }
}
