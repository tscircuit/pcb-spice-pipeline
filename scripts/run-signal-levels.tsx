import React from 'react'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
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
const timeoutMs = Number(process.env.SI_NATIVE_TIMEOUT_MS ?? 600000)
const extractionCache = new Map<string, { directory: string; result: { stdout: string; stderr: string; files: Record<string, string> } }>()
if (process.env.SI_EXTRACTION_CACHE) for (const entry of await readdir(process.env.SI_EXTRACTION_CACHE)) {
  if (!/^native-\d+-(fasthenry|fastercap)$/.test(entry)) continue
  const directory = `${process.env.SI_EXTRACTION_CACHE}/${entry}`
  const request = JSON.parse(await readFile(`${directory}/request.json`, 'utf8')) as SolverRequest
  try {
    const files = Object.fromEntries(await Promise.all(request.outputFiles.map(async file => [file, await readFile(`${directory}/${file}`, 'utf8')])) )
    extractionCache.set(createHash('sha256').update(JSON.stringify(request)).digest('hex'), { directory, result: { files, stdout: await readFile(`${directory}/stdout.log`, 'utf8'), stderr: await readFile(`${directory}/stderr.log`, 'utf8') } })
  } catch { /* Incomplete native calls cannot enter the cache. */ }
}
/** Stable native-request digest; raw files stay in ignored runs/, with no vendor redistribution. */
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
for (const [name, Board] of Object.entries({ single: Single, differential: Differential, three: Three })) {
  if (selected && selected !== name) continue
  const started = Date.now()
  let circuitJson = await renderSignals(<Board />)
  if (process.env.SI_BLOCK) {
    const block = circuitJson.find(record => record.type === 'simulation_signal_integrity' && record.name === process.env.SI_BLOCK)
    if (block?.type !== 'simulation_signal_integrity') throw new Error(`Unknown block ${process.env.SI_BLOCK}`)
    circuitJson = circuitJson.filter(record => record.type === 'simulation_signal_integrity' ? record === block : record.type === 'simulation_signal' ? record.simulation_signal_integrity_id === block.simulation_signal_integrity_id : true)
  }
  const root = `${process.env.SI_RUN_ROOT ?? 'runs/rfc-final'}/${name}`
  await mkdir(root, { recursive: true })
  await writeFile(`${root}/input.json`, JSON.stringify(circuitJson, null, 2))
  const native = createNativeSolver({ timeoutMs, tools: { fasthenry: '/opt/homebrew/bin/fasthenry', fastercap: '/opt/homebrew/bin/FasterCap', ngspice: '/opt/homebrew/bin/ngspice' } })
  const calls: unknown[] = []
  /** Capture exact requests and native outputs, including the request when execution is interrupted. */
  const solver = async (request: SolverRequest): ReturnType<typeof native> => {
    const dir = `${root}/native-${calls.length}-${request.solver}`
    const cached = request.solver === 'ngspice' ? undefined : extractionCache.get(digest(JSON.stringify(request)))
    calls.push({ solver: request.solver, request_sha256: digest(JSON.stringify(request)), args: request.args, ...(cached ? { exact_native_extraction_replay_from: cached.directory } : {}) })
    await mkdir(dir, { recursive: true })
    await writeFile(`${dir}/request.json`, JSON.stringify(request, null, 2))
    await writeFile(`${root}/native-calls.json`, JSON.stringify(calls, null, 2))
    for (const [file, body] of Object.entries(request.files)) await writeFile(`${dir}/${file}`, body)
    const output = cached?.result ?? await native(request)
    await writeFile(`${dir}/stdout.log`, output.stdout)
    await writeFile(`${dir}/stderr.log`, output.stderr)
    for (const [file, body] of Object.entries(output.files)) await writeFile(`${dir}/${file}`, body)
    return output
  }
  const provenance = { name, ...(process.env.SI_BLOCK ? { isolated_block: process.env.SI_BLOCK } : {}), native_timeout_ms: timeoutMs, implementation_head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sources: Object.fromEntries(Object.entries(ibisSources).map(([file, bytes]) => [file, digest(bytes)])),
    circuit_json_schema_sha256: digest(await readFile('node_modules/circuit-json/dist/index.mjs')) }
  try {
    const result = await runPipeline({ circuitJson, ibisSources, runSolver: solver, onProgress: console.log })
    const summary = { ...provenance, status: 'verified_native', seconds: (Date.now() - started) / 1000,
      native_execution: JSON.parse(result.files['native-execution.json']), native_requests: calls,
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
