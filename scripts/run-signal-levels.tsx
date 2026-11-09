import React from 'react'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { renderSignals } from '../tests/support/signal-render'
import { runPipeline } from '../src'
import { createNativeSolver } from '../src/adapters'
import type { SolverRequest } from '../src'
import Single from '../examples/levels/level1-single-ended'
import Differential from '../examples/levels/level1-differential'
import Three from '../examples/levels/level3-three-signals'

const modelDir = process.env.IBIS_MODEL_DIR ?? 'models'
const ibisSources = Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${modelDir}/${file}`)])))
const selected = process.argv[2]
/** Stable native-request digest; raw files stay in ignored runs/, with no vendor redistribution. */
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
for (const [name, Board] of Object.entries({ single: Single, differential: Differential, three: Three })) {
  if (selected && selected !== name) continue
  const started = Date.now()
  const circuitJson = await renderSignals(<Board />)
  const root = `runs/rfc-final/${name}`
  await mkdir(root, { recursive: true })
  await writeFile(`${root}/input.json`, JSON.stringify(circuitJson, null, 2))
  const native = createNativeSolver({ timeoutMs: 600000, tools: { fasthenry: '/opt/homebrew/bin/fasthenry', fastercap: '/opt/homebrew/bin/FasterCap', ngspice: '/opt/homebrew/bin/ngspice' } })
  const calls: unknown[] = []
  /** Capture exact requests and native outputs, including the request when execution is interrupted. */
  const solver = async (request: SolverRequest): ReturnType<typeof native> => {
    const dir = `${root}/native-${calls.length}-${request.solver}`
    calls.push({ solver: request.solver, request_sha256: digest(JSON.stringify(request)), args: request.args })
    await mkdir(dir, { recursive: true })
    await writeFile(`${dir}/request.json`, JSON.stringify(request, null, 2))
    await writeFile(`${root}/native-calls.json`, JSON.stringify(calls, null, 2))
    for (const [file, body] of Object.entries(request.files)) await writeFile(`${dir}/${file}`, body)
    const output = await native(request)
    await writeFile(`${dir}/stdout.log`, output.stdout)
    await writeFile(`${dir}/stderr.log`, output.stderr)
    for (const [file, body] of Object.entries(output.files)) await writeFile(`${dir}/${file}`, body)
    return output
  }
  const provenance = { name, implementation_head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sources: Object.fromEntries(Object.entries(ibisSources).map(([file, bytes]) => [file, digest(bytes)])),
    circuit_json_schema_sha256: digest(await readFile('node_modules/circuit-json/dist/index.mjs')) }
  try {
    const result = await runPipeline({ circuitJson, ibisSources, runSolver: solver, onProgress: console.log })
    const summary = { ...provenance, status: 'verified_native', seconds: (Date.now() - started) / 1000,
      native_execution: JSON.parse(result.files['native-execution.json']),
      transient_convergence: Object.fromEntries(Object.entries(result.files).filter(([file]) => file.endsWith('numerical-convergence.json')).map(([file, body]) => [file, JSON.parse(body)])),
      blocks: result.blocks.map(block => ({ name: block.name, duration_s: block.duration_s, numericalSettings: block.numericalSettings,
        results: block.results.filter(r => r.type !== 'simulation_signal_waveform').map(r => r.type === 'simulation_signal_eye' ? { ...r, folded_traces: undefined } : r), limitations: block.limitations })) }
    await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
    for (const [file, body] of Object.entries(result.files)) {
      await mkdir(`${root}/${dirname(file)}`, { recursive: true })
      await writeFile(`${root}/${file}`, body)
    }
    console.log(JSON.stringify(summary))
  } catch (error) {
    const failure = error as Error & { code?: string; convergence?: unknown }
    const summary = { ...provenance, status: 'failed_native', seconds: (Date.now() - started) / 1000, error: failure.message, code: failure.code, convergence: failure.convergence, native_execution: calls }
    await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
    throw error
  }
}
