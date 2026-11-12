import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

// This child is launched only by the machine-wide lock from research-ibis-weights.tsx.
if (process.env.OMP_NUM_THREADS !== '1') throw new Error('Use the shared ngspice lock')
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (!(request.timeoutMs > 0 && request.timeoutMs <= 600000)) throw new Error('Native run exceeds ten-minute cap')
const directory = dirname(process.argv[2])
const started = performance.now()
const result = spawnSync(process.env.NGSPICE_BIN ?? '/opt/homebrew/bin/ngspice', request.args, {
  cwd: directory, encoding: 'utf8', timeout: request.timeoutMs, killSignal: 'SIGTERM',
  maxBuffer: 32 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: '1', SPICE_ASCIIRAWFILE: '1' },
})
writeFileSync(join(directory, 'stdout.log'), result.stdout ?? '')
writeFileSync(join(directory, 'stderr.log'), result.stderr ?? '')
writeFileSync(join(directory, 'run.json'), JSON.stringify({ wallSeconds: (performance.now() - started) / 1000,
  status: result.status, signal: result.signal, error: result.error?.message, capped: result.error?.code === 'ETIMEDOUT' }, null, 2))
