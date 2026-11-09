import React from 'react'
import { execFileSync } from 'node:child_process'
import { access, readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { dirname } from 'node:path'
import { renderCoreSignals } from '../tests/support/core-render'
import { runPipeline, type SolverRequest, type SolverResult } from '../src'
import { createNativeSolver } from '../src/adapters'
import Single from '../examples/level1-single-ended/level1-single-ended'
import Differential from '../examples/level1-differential/level1-differential'
import Two from '../examples/level2-two-channels/level2-two-channels'
import Three from '../examples/level3-three-channels/level3-three-channels'
import DDR3 from '../examples/level4-ddr3-write/level4-ddr3-write'
import type { CircuitJson } from '../src/board'

process.env.OMP_NUM_THREADS = '1'
const boards = { single: Single, differential: Differential, two: Two, three: Three, ddr3: DDR3 }
const names = { single: 'level1-single-ended', differential: 'level1-differential', two: 'level2-two-channels', three: 'level3-three-channels', ddr3: 'level4-ddr3-write' }
const timeoutMs = Number(process.env.SI_NATIVE_TIMEOUT_MS ?? 1200000)
const cache = new Map<string, string>()
/** Stable exact-byte request and source identity. */
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
/** Losslessly archive large evidence, retaining every native timestamp. */
const archive = async (path: string, body: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(body.length > 2_000_000 ? `${path}.gz` : path, body.length > 2_000_000 ? gzipSync(body, { level: 1 }) : body)
}
/** Read exact archived native bytes. */
const readArchive = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return gunzipSync(await readFile(`${path}.gz`)).toString()
  }
}
/** Index completed requests only; adaptive traces are never synthesized or approximately matched. */
async function indexCache(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = `${directory}/${entry.name}`
    if (!/^native-\d+-/.test(entry.name)) {
      await indexCache(path)
      continue
    }
    try {
      const request = JSON.parse(await readFile(`${path}/request.json`, 'utf8')) as SolverRequest
      if (request.solver === 'ngspice' && process.env.SI_REPLAY_COMPLETE_NATIVE !== '1') continue
      await Promise.all(['stdout.log', 'stderr.log', ...request.outputFiles].map(file => access(`${path}/${file}`).catch(() => access(`${path}/${file}.gz`))))
      cache.set(digest(JSON.stringify(request)), path)
    } catch { /* Interrupted or missing native output is not reusable. */ }
  }
}
for (const directory of (process.env.SI_EXTRACTION_CACHE ?? '').split(':').filter(Boolean)) await indexCache(directory)
for (const [key, Board] of Object.entries(boards) as [keyof typeof boards, typeof Single][]) {
  if ((process.argv[2] && process.argv[2] !== key) || process.env.SI_SKIP_LEVEL === key) continue
  for (const selectedBlock of key === 'three' ? ['TRAFFIC', 'XTALK_LOW', 'XTALK_HIGH'] : [undefined]) {
    if (process.env.SI_BLOCK && process.env.SI_BLOCK !== selectedBlock) continue
  const level = names[key]
  const root = `${process.env.SI_RUN_ROOT ?? 'runs/final-rfc'}/${key}${selectedBlock ? `/${selectedBlock}` : ''}`
  await mkdir(root, { recursive: true })
  const started = Date.now()
  const calls: { solver: string; request_sha256: string; reused_from?: string; wall_seconds?: number }[] = []
  const ibisSources: Record<string, Uint8Array> = Object.fromEntries(await Promise.all((key === 'ddr3' ? ['sprm552c.ibs', 'W631GG6MB-12.ibs'] : ['sn74lvc1g04.ibs', 'sn65hvd72.ibs']).map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)])))
  const native = createNativeSolver({ timeoutMs, tools: { fasthenry: '/opt/homebrew/bin/fasthenry', fastercap: '/opt/homebrew/bin/FasterCap', ngspice: '/opt/homebrew/bin/ngspice' } })
  /** Run exactly one solver, recording memory before each uncached call and refusing overlap. */
  const solver = async (request: SolverRequest): Promise<SolverResult> => {
    const hash = digest(JSON.stringify(request))
    const previous = cache.get(hash)
    const directory = `${root}/native-${calls.length}-${request.solver}`
    calls.push({ solver: request.solver, request_sha256: hash, ...(previous ? { reused_from: previous } : {}) })
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/request.json`, JSON.stringify(request, null, 2))
    await writeFile(`${root}/native-calls.json`, JSON.stringify(calls, null, 2))
    if (key === 'ddr3') throw new Error('DDR3 invoked a native solver before its documented package boundary')
    if (!previous) {
      if (process.env.SI_REQUIRE_COMPLETE_CACHE === '1') throw new Error(`Exact complete cache missing for ${request.solver}`)
      const processes = execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' })
      if (processes.split('\n').some(line => /\/(?:FasterCap|fasthenry|ngspice)\s*$/.test(line))) throw new Error('Another native solver is running')
      const memory = execFileSync('vm_stat', { encoding: 'utf8' })
      await writeFile(`${directory}/memory-before.log`, memory)
      const pageSize = Number(/page size of (\d+)/.exec(memory)?.[1] ?? 16384)
      const available = [...memory.matchAll(/Pages (?:free|inactive|purgeable):\s+(\d+)/g)].reduce((sum, match) => sum + Number(match[1]) * pageSize, 0)
      if (available < 512 * 1024 ** 2) throw new Error(`Insufficient available memory before ${request.solver}: ${available} bytes`)
      console.log(`Starting ${request.solver} #${calls.length - 1}; available ${Math.round(available / 1024 ** 2)} MiB; timeout ${timeoutMs} ms`)
    }
    const began = Date.now()
    try {
      const output: SolverResult = previous ? { stdout: await readArchive(`${previous}/stdout.log`), stderr: await readArchive(`${previous}/stderr.log`), files: Object.fromEntries(await Promise.all(request.outputFiles.map(async file => [file, await readArchive(`${previous}/${file}`)]))) } : await native(request)
      await archive(`${directory}/stdout.log`, output.stdout)
      await archive(`${directory}/stderr.log`, output.stderr)
      for (const [file, body] of Object.entries(output.files)) await archive(`${directory}/${file}`, body)
      cache.set(hash, directory)
      return output
    } finally {
      calls.at(-1)!.wall_seconds = (Date.now() - began) / 1000
      await writeFile(`${root}/native-calls.json`, JSON.stringify(calls, null, 2))
    }
  }
  const provenance = { level, core_module: process.env.SI_CORE_MODULE, example_sha256: digest(await readFile(`examples/${level}/${level}.tsx`)), native_timeout_ms: timeoutMs,
    implementation_head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ibis_sha256: Object.fromEntries(Object.entries(ibisSources).map(([file, bytes]) => [file, digest(bytes)])) }
  let circuitJson: CircuitJson = []
  try {
    circuitJson = await renderCoreSignals(<Board />)
    if (selectedBlock) {
      const block = circuitJson.find(record => record.type === 'simulation_signal_integrity' && record.name === selectedBlock)
      if (block?.type !== 'simulation_signal_integrity') throw new Error(`Unknown block ${selectedBlock}`)
      circuitJson = circuitJson.filter(record => record.type === 'simulation_signal_integrity' ? record === block : record.type === 'simulation_signal' ? record.simulation_signal_integrity_id === block.simulation_signal_integrity_id : true)
    }
    await writeFile(`${root}/input.json`, JSON.stringify(circuitJson, null, 2))
    const result = await runPipeline({ circuitJson, ibisSources, runSolver: solver, onProgress: console.log })
    for (const block of result.blocks) for (const record of block.results) if (record.type === 'simulation_signal_waveform') await archive(`${root}/waveforms/${record.simulation_signal_waveform_id}.json`, JSON.stringify(record))
    const summary = { ...provenance, status: 'verified_native', seconds: (Date.now() - started) / 1000, native_requests: calls,
      convergence: Object.fromEntries(Object.entries(result.files).filter(([file]) => /(?:convergence|checks)\.json$/.test(file)).map(([file, body]) => [file, JSON.parse(body)])),
      blocks: result.blocks.map(block => ({ name: block.name, simulation_signal_integrity_id: block.simulation_signal_integrity_id, duration_s: block.duration_s,
        results: block.results.map(record => record.type === 'simulation_signal_waveform' ? { ...record, timestamps_s: undefined, voltage_levels: undefined, samples: record.timestamps_s.length } : record), limitations: block.limitations })) }
    await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
    for (const [file, body] of Object.entries(result.files)) await archive(`${root}/${file}`, body)
    console.log(`${level}: verified native in ${summary.seconds}s`)
  } catch (error) {
    const failure = error as Error & { code?: string; convergence?: unknown; circuitJson?: CircuitJson }
    circuitJson = failure.circuitJson ?? circuitJson
    await writeFile(`${root}/input.json`, JSON.stringify(circuitJson, null, 2))
    await writeFile(`${root}/summary.json`, JSON.stringify({ ...provenance, status: calls.length ? 'failed_native' : 'rejected_before_native', seconds: (Date.now() - started) / 1000, error: failure.message, code: failure.code, convergence: failure.convergence, native_requests: calls }, null, 2) + '\n')
    console.error(failure.message)
    if (key !== 'ddr3' || failure.message !== '.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.' || calls.length) process.exitCode = 1
  }
}
}
