import React from 'react'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { dirname } from 'node:path'
import { renderCoreSignals } from '../tests/support/core-render'
import { runPipeline } from '../src'
import { createNativeSolver } from '../src/adapters'
import type { SolverRequest } from '../src'
import Single from '../examples/levels/level1-single-ended'
import Differential from '../examples/levels/level1-differential'
import Two from '../examples/levels/level2-two-signals'
import Three from '../examples/levels/level3-three-signals'
import type { CircuitJson } from '../src/board'
import { prepareBlocks } from '../src/pipeline/signals'
import { receiverThresholds } from '../src/buffers'

const modelDir = process.env.IBIS_MODEL_DIR ?? 'models'
const ibisSources: Record<string, Uint8Array> = Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${modelDir}/${file}`)])))
const selected = process.argv[2]
/** Retain large solver artifacts losslessly without exhausting the local evidence volume. */
const archive = async (path: string, body: string): Promise<void> => {
  if (body.length > 2_000_000) await writeFile(`${path}.gz`, gzipSync(body, { level: 1 }))
  else await writeFile(path, body)
}
const timeoutMs = Number(process.env.SI_NATIVE_TIMEOUT_MS ?? 180000)
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
for (const [name, Board] of Object.entries({ single: Single, differential: Differential, two: Two, three: Three })) {
  if (selected && selected !== name) continue
  const started = Date.now()
  let circuitJson: CircuitJson = []
  const root = `${process.env.SI_RUN_ROOT ?? 'runs/rfc-final'}/${name}`
  await mkdir(root, { recursive: true })
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
    for (const [file, body] of Object.entries(request.files)) await archive(`${dir}/${file}`, body)
    const output = cached?.result ?? await native(request)
    await writeFile(`${dir}/stdout.log`, output.stdout)
    await writeFile(`${dir}/stderr.log`, output.stderr)
    for (const [file, body] of Object.entries(output.files)) await archive(`${dir}/${file}`, body)
    return output
  }
  const provenance = { name, rendering: 'real_core_without_adapter', core_module: process.env.SI_CORE_MODULE ?? '@tscircuit/core',
    core_sha256: digest(await readFile(process.env.SI_CORE_MODULE ?? import.meta.resolve('@tscircuit/core').replace('file://', ''))),
    example_sha256: digest(await readFile(new URL(`../examples/levels/${({ single: 'level1-single-ended', differential: 'level1-differential', two: 'level2-two-signals', three: 'level3-three-signals' })[name]}.tsx`, import.meta.url))),
    large_artifacts: 'gzip_level_1_above_2_MB', runner_sha256: digest(await readFile(new URL(import.meta.url))), ...(process.env.SI_BLOCK ? { isolated_block: process.env.SI_BLOCK } : {}), native_timeout_ms: timeoutMs, implementation_head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sources: Object.fromEntries(Object.entries(ibisSources).map(([file, bytes]) => [file, digest(bytes)])),
    circuit_json_schema_sha256: digest(await readFile('node_modules/circuit-json/dist/index.mjs')) }
  try {
    circuitJson = await renderCoreSignals(<Board />)
    if (process.env.SI_BLOCK) {
      const block = circuitJson.find(record => record.type === 'simulation_signal_integrity' && record.name === process.env.SI_BLOCK)
      if (block?.type !== 'simulation_signal_integrity') throw new Error(`Unknown block ${process.env.SI_BLOCK}`)
      circuitJson = circuitJson.filter(record => record.type === 'simulation_signal_integrity' ? record === block : record.type === 'simulation_signal' ? record.simulation_signal_integrity_id === block.simulation_signal_integrity_id : true)
    }
    await writeFile(`${root}/input.json`, JSON.stringify(circuitJson, null, 2))
    const result = await runPipeline({ circuitJson, ibisSources, runSolver: solver, onProgress: console.log })
    const prepared = prepareBlocks(circuitJson, ibisSources)
    const plot = result.blocks.map((block, index) => ({ name: block.name, gate_s: block.numericalSettings.measurementGate,
      signals: prepared[index].signals.map(signal => ({ ...signal, thresholds: Object.fromEntries(signal.receivers.map(receiver => {
        const port = receiver.kind === 'single' ? receiver.source_port_id : receiver.p_source_port_id
        return [port, receiverThresholds(prepared[index].pins.get(port)!, receiver.kind === 'differential', signal.mask, { typ: 0, min: 1, max: 2 }[prepared[index].block.corner])]
      })) })),
      results: block.results.map(record => {
        if (record.type === 'simulation_signal_eye') return { ...record, folded_traces: undefined }
        if (record.type !== 'simulation_signal_waveform') return record
        const stride = Math.max(1, Math.ceil(record.timestamps_s.length / 30000))
        const indices = new Set([0, record.timestamps_s.length - 1])
        for (let i = 0; i < record.timestamps_s.length; i += stride) {
          let low = i
          let high = i
          for (let j = i; j < Math.min(i + stride, record.timestamps_s.length); j++) {
            if (record.voltage_levels[j] < record.voltage_levels[low]) low = j
            if (record.voltage_levels[j] > record.voltage_levels[high]) high = j
          }
          indices.add(low)
          indices.add(high)
        }
        const ordered = [...indices].sort((a, b) => a - b)
        return { ...record, full_resolution_samples: record.timestamps_s.length,
          full_resolution_sha256: digest(JSON.stringify(record)), timestamps_s: ordered.map(i => record.timestamps_s[i]), voltage_levels: ordered.map(i => record.voltage_levels[i]) }
      }) }))
    await writeFile(`${root}/plot-evidence.json.gz`, gzipSync(JSON.stringify(plot), { level: 9 }))
    const summary = { ...provenance, status: 'verified_native', seconds: (Date.now() - started) / 1000,
      native_execution: JSON.parse(result.files['native-execution.json']), native_requests: calls,
      transient_convergence: Object.fromEntries(Object.entries(result.files).filter(([file]) => file.endsWith('numerical-convergence.json')).map(([file, body]) => [file, JSON.parse(body)])),
      blocks: result.blocks.map(block => ({ name: block.name, duration_s: block.duration_s, numericalSettings: block.numericalSettings,
        extraction: block.matrices.map((matrix, stage) => ({ ...matrix, per_length: matrix.L.map((row, i) => ({ length_m: block.geometry.cells[stage].conductors[i].lengthM,
          L_h_per_m: row[i] / block.geometry.cells[stage].conductors[i].lengthM, C_f_per_m: matrix.C[i][i] / block.geometry.cells[stage].conductors[i].lengthM })) })),
        results: block.results.filter(r => r.type !== 'simulation_signal_waveform').map(r => r.type === 'simulation_signal_eye' ? { ...r, folded_traces: undefined } : r), limitations: block.limitations })) }
    await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
    for (const [file, body] of Object.entries(result.files)) {
      await mkdir(`${root}/${dirname(file)}`, { recursive: true })
      await archive(`${root}/${file}`, body)
    }
    console.log(JSON.stringify(summary))
  } catch (error) {
    const failure = error as Error & { code?: string; convergence?: unknown; circuitJson?: CircuitJson }
    circuitJson = failure.circuitJson ?? circuitJson
    await writeFile(`${root}/input.json`, JSON.stringify(circuitJson, null, 2))
    const summary = { ...provenance, status: calls.length ? 'failed_native' : 'rejected_before_native', seconds: (Date.now() - started) / 1000, error: failure.message, code: failure.code, convergence: failure.convergence, native_execution: calls,
      physical_records: Object.fromEntries(['pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuitJson.filter(record => record.type === type).length])) }
    await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
    await writeFile(`${root}/plot-evidence.json.gz`, gzipSync(JSON.stringify([]), { level: 9 }))
    console.error(JSON.stringify(summary))
    process.exitCode = 1
  }
}
