import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fullBoardDdr3 } from '../tests/support/full-board-ddr3'
import { prepareBlocks } from '../src/pipeline/signals'
import { routedSimulation } from '../src/pipeline'
import { routedControl } from '../src/simulation'

const boardPath = process.env.SI_DDR3_BOARD
const corePath = process.env.SI_CORE_MODULE
if (!boardPath || !corePath) throw new Error('Set SI_DDR3_BOARD, SI_CORE_MODULE and IBIS_MODEL_DIR; original board/models remain read-only')
const mode = process.argv[2] ?? 'dq0'
if (!['dq0', 'lane'].includes(mode)) throw new Error('Expected dq0 or lane')
const refinement = Number(process.env.SI_ROUTE_REFINEMENT ?? 1)
const step = Number(process.env.SI_ROUTE_STEP_PS ?? 10) * 1e-12
const duration = Number(process.env.SI_ROUTE_DURATION_NS ?? 10) * 1e-9
if (step >= duration || ![step, duration, Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9)].every(value => Number.isFinite(value) && value > 0)) throw new Error('Positive finite duration, timestep and current tolerance required')
const directory = resolve(`runs/routed-2d/${mode}-s${refinement}-t${Math.round(step * 1e12)}-n${Math.round(duration * 1e9)}`)
await mkdir(directory, { recursive: true })
await Promise.all(['waveform.dat', 'receiver.csv', 'result.json', 'failure.json', 'ngspice-native.log', 'ngspice.log'].map(file => rm(`${directory}/${file}`, { force: true })))
const circuit = await fullBoardDdr3(boardPath)
const specs = await import(pathToFileURL(resolve(dirname(corePath), '../node_modules/@tscircuit/jlcpcb-manufacturing-specs/index.ts')).href)
const preset = specs.getJlcStackup({ num_layers: 8, thickness: 1.2, material: 'fr4' })
if (preset.name !== 'JLC08121H-3313') throw new Error(`Unexpected stackup ${preset.name}`)
circuit.push({ type: 'pcb_stackup', pcb_stackup_id: 'assumed_jlc', pcb_board_id: circuit.find(record => record.type === 'pcb_board')!.pcb_board_id, plated_hole_copper_thickness: .018, layers: preset.layers })
for (const [i, signal] of circuit.filter(record => record.type === 'simulation_signal').entries()) if (signal.pattern === 'prbs7') signal.seed = 85 - i * 3
for (let i = circuit.length - 1; i >= 0; i--) {
  const record = circuit[i]
  if (mode === 'dq0' && record.type === 'simulation_signal' && record.name !== 'DQ0') circuit.splice(i, 1)
}
const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)] as const)))
const preparation = performance.now()
const [block] = prepareBlocks(circuit, sources, '2d')
const preparationMs = performance.now() - preparation
console.log(`${mode}: declarations ready in ${preparationMs.toFixed(0)} ms`)
const hashes = { board_sha256: createHash('sha256').update(await readFile(boardPath)).digest('hex'), sources: Object.fromEntries(Object.entries(sources).map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')])) }
const extractionStart = performance.now()
let result: Pick<ReturnType<typeof routedSimulation>, 'deck' | 'evidence' | 'probes' | 'timings'>
try {
  const reuse = process.env.SI_ROUTE_REUSE_DIR
  if (reuse) {
    const ledger = JSON.parse(await readFile(`${reuse}/extraction.json`, 'utf8'))
    if (duration > ledger.options.durationSeconds * (1 + 1e-12) || process.env.SI_ROUTE_PANELS && Number(process.env.SI_ROUTE_PANELS) !== ledger.options.panels) throw new Error('Compiled deck cannot extend switching history or change its field mesh')
    if (JSON.stringify(ledger.hashes) !== JSON.stringify(hashes) || ledger.options.refinement !== refinement || !(mode === 'dq0' ? ledger.probe_names.length === 1 && ledger.probe_names[0].startsWith('DQ0_') : ledger.probe_names.some((name: string) => name.startsWith('DQM0_')))) throw new Error('Compiled deck does not match board, models, mode or spatial refinement')
    const deck = await readFile(`${reuse}/simulation.cir`, 'utf8')
    result = { deck: deck.slice(0, deck.indexOf('.control\n')).replace(/abstol=[^\s]+/, `abstol=${Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9)}`) + routedControl(ledger.probes, /^save (.+)$/m.exec(deck)![1], step, duration).join('\n') + '\n', probes: ledger.probe_names, timings: {},
      evidence: { ...ledger, options: { ...ledger.options, stepSeconds: step, durationSeconds: duration, currentToleranceA: Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9) }, reused_extraction: { directory: resolve(reuse), deck_sha256: createHash('sha256').update(deck).digest('hex'), timings: ledger.timings } } }
  } else result = routedSimulation(block, sources, { riseSeconds: 230e-12, refinement, stepSeconds: step, durationSeconds: duration, panels: Number(process.env.SI_ROUTE_PANELS ?? 12), currentToleranceA: Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9) })
} catch (error) {
  await writeFile(`${directory}/failure.json`, JSON.stringify({ status: 'extraction-failed', mode, hashes, scope: block.settings.copperScope, preparation_ms: preparationMs, extraction_ms: performance.now() - extractionStart, error: { message: (error as Error).message, ...error as object } }, null, 2))
  throw error
}
await writeFile(`${directory}/simulation.cir`, result.deck)
await writeFile(`${directory}/extraction.json`, JSON.stringify({ ...result.evidence, hashes, timings: { preparation_ms: preparationMs, ...result.timings }, probe_names: result.probes }, null, 2))
console.log(JSON.stringify({ directory, ...result.timings, sections: result.evidence.sections, solves: result.evidence.unique_cross_sections, cells: result.evidence.cells, netlist_bytes: result.deck.length }))
if (process.env.SI_ROUTE_EXTRACT_ONLY === '1') process.exit(0)
// One cross-process exclusive lock for all instances of this runner; stale locks require an explicit audit.
const nativeLimit = Number(process.env.SI_ROUTE_NATIVE_LIMIT_SECONDS ?? 1200)
if (!(nativeLimit > 0 && nativeLimit <= 1200)) throw new Error('Native runtime limit must be in (0,1200] seconds')
const lockPath = resolve('runs/routed-2d/ngspice.lock')
const lock = await open(lockPath, 'wx')
await lock.writeFile(String(process.pid))
const start = performance.now()
let peakRssKiB = 0
try {
  await new Promise<void>((accept, reject) => {
    const child = spawn(process.env.NGSPICE_BIN ?? '/opt/homebrew/bin/ngspice', ['-b', '-o', 'ngspice-native.log', 'simulation.cir'], { cwd: directory, env: { ...process.env, OMP_NUM_THREADS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    let firstProgress: { time: number; seconds: number } | undefined
    let budgetError = ''
    const projection = setInterval(async () => {
      if (child.pid) {
        const memory = await promisify(execFile)('ps', ['-o', 'rss=', '-p', String(child.pid)]).catch(() => ({ stdout: '0' }))
        peakRssKiB = Math.max(peakRssKiB, Number(memory.stdout.trim()) || 0)
        if (peakRssKiB > 1024 * 1024) {
          budgetError = 'Native memory exceeded 1 GiB budget'
          child.kill('SIGTERM')
        }
      }
      const text = await readFile(`${directory}/ngspice-native.log`, 'utf8').catch(() => '')
      const values = [...text.matchAll(/(?:Reference value\s*:|SI_PROGRESS)\s*([\d.eE+-]+)/g)]
      const snapshot = await readFile(`${directory}/waveform.dat`, 'utf8').catch(() => '')
      const seconds = Number(snapshot.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/)[0]) || Number(values.at(-1)?.[1])
      const time = performance.now()
      if (!(seconds > 0)) return
      firstProgress ??= { time, seconds }
      if (time - firstProgress.time > 15000) {
        const upper = Math.min(duration, Math.ceil((seconds + 1e-15) / 5e-10) * 5e-10)
        const projected = (firstProgress.time - start) / 1000 + (time - firstProgress.time) / 1000 * (duration - firstProgress.seconds) / (upper - firstProgress.seconds)
        if (projected > 1200) {
          budgetError = `Projected transient ${projected.toFixed(0)} s exceeds 20 minute budget`
          child.kill('SIGTERM')
        }
      }
    }, 5000)
    const timer = setTimeout(() => {
      budgetError = `Native runtime exceeded ${nativeLimit} s budget`
      child.kill('SIGTERM')
    }, nativeLimit * 1000)
    child.stdout.on('data', chunk => {
      log += String(chunk)
    })
    child.stderr.on('data', chunk => {
      log += String(chunk)
    })
    child.on('error', error => {
      clearTimeout(timer)
      clearInterval(projection)
      reject(error)
    })
    child.on('close', async code => {
      clearTimeout(timer)
      clearInterval(projection)
      log += await readFile(`${directory}/ngspice-native.log`, 'utf8').catch(() => '')
      await writeFile(`${directory}/ngspice.log`, log)
      if (code !== 0 || /timestep too small|run simulation\(s\) aborted|fatal error|out of memory/i.test(log)) reject(new Error(`${budgetError || `ngspice failed (${code})`}; inspect ${directory}/ngspice.log`))
      else accept()
    })
  })
  const rows = (await readFile(`${directory}/waveform.dat`, 'utf8')).trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).map(Number))
  if (!rows.length || rows.some(row => row.length !== result.probes.length + 1 || row.some(value => !Number.isFinite(value))) || rows.at(-1)![0] < duration * .999) throw new Error('Incomplete/nonfinite receiver waveform')
  await writeFile(`${directory}/receiver.csv`, ['time_s,' + result.probes.join(','), ...rows.map(row => row.join(','))].join('\n') + '\n')
  await writeFile(`${directory}/result.json`, JSON.stringify({ status: 'candidate-unqualified', native_peak_rss_kib: peakRssKiB, convergence: 'not evaluated', hashes, mode, label: 'JLC standard stackup (assumed)', timings: { preparation_ms: preparationMs, ...result.timings, transient_ms: performance.now() - start }, samples: rows.length,
    receiver_ranges_v: result.probes.map((probe, i) => ({ probe, min: Math.min(...rows.map(row => row[i + 1])), max: Math.max(...rows.map(row => row[i + 1])) })) }, null, 2))
  console.log(`Completed ${mode} transient in ${((performance.now() - start) / 1000).toFixed(3)} s; ${rows.length} native samples`)
} catch (error) {
  const partial = await readFile(`${directory}/waveform.dat`, 'utf8').catch(() => '')
  if (partial.trim().split(/\r?\n/).length > 1) await writeFile(`${directory}/receiver-incomplete.csv`, ['time_s,' + result.probes.join(','), ...partial.trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).join(','))].join('\n') + '\n')
  await writeFile(`${directory}/failure.json`, JSON.stringify({ status: 'transient-failed', native_peak_rss_kib: peakRssKiB, mode, hashes, timings: { preparation_ms: preparationMs, ...result.timings, transient_ms: performance.now() - start }, error: (error as Error).message }, null, 2))
  throw error
} finally {
  await lock.close()
  await rm(lockPath)
}
