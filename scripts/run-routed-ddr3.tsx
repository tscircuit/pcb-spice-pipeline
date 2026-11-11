import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { routedNative } from './routed-native'
import { fullBoardDdr3, type Ddr3Options } from '../tests/support/full-board-ddr3'
import type { RouteFieldCache } from '../src/extraction'
import { prepareBlocks } from '../src/pipeline/signals'
import { routedSimulation } from '../src/pipeline'
import { routedControl } from '../src/simulation'

const boardPath = process.env.SI_DDR3_BOARD
if (!boardPath) throw new Error('Set SI_DDR3_BOARD and IBIS_MODEL_DIR; original board/models remain read-only')
const mode = process.argv[2] ?? 'dq0'
if (!['dq0', 'lane', 'addr-cmd'].includes(mode)) throw new Error('Expected dq0, lane or addr-cmd')
const requestedBlock = process.env.SI_ROUTE_BLOCK ?? (mode === 'addr-cmd' ? 'DDR3_ADDR_CMD' : 'DDR3_LOWER_WRITE')
if (requestedBlock !== 'DDR3_ADDR_CMD' && requestedBlock !== 'DDR3_LOWER_WRITE') throw new Error(`Unknown DDR3 block ${requestedBlock}`)
const blockName: NonNullable<Ddr3Options['block']> = requestedBlock
const pattern = process.env.SI_ROUTE_PATTERN ?? 'prbs7'
if (pattern !== 'prbs7' && pattern !== 'simultaneous' && pattern !== 'quiet' && pattern !== 'victim-even' && pattern !== 'victim-odd') throw new Error('Expected prbs7, simultaneous, quiet, victim-even or victim-odd pattern')
const refinement = Number(process.env.SI_ROUTE_REFINEMENT ?? 1)
const step = Number(process.env.SI_ROUTE_STEP_PS ?? 10) * 1e-12
const duration = Number(process.env.SI_ROUTE_DURATION_NS ?? (mode === 'addr-cmd' ? 8 : 10)) * 1e-9
const cellsPerRise = Number(process.env.SI_ROUTE_CELLS_PER_RISE ?? 2)
const distance = Number(process.env.SI_ROUTE_DISTANCE_MM ?? (mode === 'addr-cmd' ? 1 : 32))
if (step >= duration || ![step, duration, Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9)].every(value => Number.isFinite(value) && value > 0)) throw new Error('Positive finite duration, timestep and current tolerance required')
const directory = resolve(process.env.SI_ROUTE_RUN_DIR ?? `runs/routed-2d/step3/${mode}-r${distance}-c${cellsPerRise}-s${refinement}-t${Math.round(step * 1e12)}-n${Math.round(duration * 1e9)}`)
const fieldCache: RouteFieldCache = { panels: Number(process.env.SI_ROUTE_PANELS ?? 12), sections: new Map(), oblique: new Map() }

/** Reuse physical fields across serial stimuli; native captures remain independently guarded. */
async function capture(pattern: NonNullable<Ddr3Options['pattern']>, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await Promise.all(['waveform.dat', 'receiver.csv', 'receiver-incomplete.csv', 'result.json', 'failure.json', 'native.json', 'ngspice-native.log', 'ngspice.log'].map(file => rm(`${directory}/${file}`, { force: true })))
  const circuit = await fullBoardDdr3(boardPath!, { block: blockName, pattern, durationSeconds: duration })
  for (let i = circuit.length - 1; i >= 0; i--) {
    const record = circuit[i]
    if (mode === 'dq0' && record.type === 'simulation_signal' && record.name !== 'DQ0') circuit.splice(i, 1)
  }
  const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)] as const)))
  const preparation = performance.now()
  const block = prepareBlocks(circuit, sources, '2d', distance).find(prepared => prepared.block.name === blockName)
  if (!block) throw new Error(`Missing requested simulation block ${blockName}`)
  const preparationMs = performance.now() - preparation
  console.log(`${mode}: declarations ready in ${preparationMs.toFixed(0)} ms`)
  const hashes = { board_sha256: createHash('sha256').update(await readFile(boardPath!)).digest('hex'), block: blockName, pattern, sources: Object.fromEntries(Object.entries(sources).map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')])) }
  const extractionStart = performance.now()
  let result: Pick<ReturnType<typeof routedSimulation>, 'deck' | 'evidence' | 'probes' | 'timings'>
  try {
    const reuse = process.env.SI_ROUTE_REUSE_DIR
    if (reuse) {
      const ledger = JSON.parse(await readFile(`${reuse}/extraction.json`, 'utf8'))
      if (duration > ledger.options.durationSeconds * (1 + 1e-12) || process.env.SI_ROUTE_PANELS && Number(process.env.SI_ROUTE_PANELS) !== ledger.options.panels) throw new Error('Compiled deck cannot extend switching history or change its field mesh')
      if (JSON.stringify(ledger.hashes) !== JSON.stringify(hashes) || ledger.scope.lateralDistanceMm !== distance || ledger.options.refinement !== refinement || ledger.options.cellsPerRise !== cellsPerRise) throw new Error('Compiled deck does not match board, models, block, pattern, copper scope or spatial refinement')
      const deck = await readFile(`${reuse}/simulation.cir`, 'utf8')
      result = { deck: deck.slice(0, deck.indexOf('.control\n')).replace(/abstol=[^\s]+/, `abstol=${Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9)}`) + routedControl(ledger.probes, /^save (.+)$/m.exec(deck)![1], step, duration).join('\n') + '\n', probes: ledger.probe_names, timings: {},
        evidence: { ...ledger, options: { ...ledger.options, stepSeconds: step, durationSeconds: duration, currentToleranceA: Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9) }, reused_extraction: { directory: resolve(reuse), deck_sha256: createHash('sha256').update(deck).digest('hex'), timings: ledger.timings } } }
    } else result = routedSimulation(block, sources, { riseSeconds: 230e-12, refinement, stepSeconds: step, durationSeconds: duration, panels: Number(process.env.SI_ROUTE_PANELS ?? 12), currentToleranceA: Number(process.env.SI_ROUTE_ABSTOL ?? 1e-9), cellsPerRise, fieldCache })
  } catch (error) {
    await writeFile(`${directory}/failure.json`, JSON.stringify({ status: 'extraction-failed', mode, hashes, scope: block.settings.copperScope, preparation_ms: preparationMs, extraction_ms: performance.now() - extractionStart, error: { message: (error as Error).message, ...error as object } }, null, 2))
    throw error
  }
  await writeFile(`${directory}/simulation.cir`, result.deck)
  await writeFile(`${directory}/extraction.json`, JSON.stringify({ ...result.evidence, hashes, stimuli: block.signals.map(signal => ({ name: signal.name, pattern: signal.pattern, seed: signal.seed, bit_rate_bps: signal.bit_rate_bps, offset_s: signal.offset_s })), timings: { preparation_ms: preparationMs, ...result.timings }, probe_names: result.probes }, null, 2))
  console.log(JSON.stringify({ directory, ...result.timings, sections: result.evidence.sections, solves: result.evidence.unique_cross_sections, cells: result.evidence.cells, netlist_bytes: result.deck.length }))
  if (process.env.SI_ROUTE_EXTRACT_ONLY === '1') return
  const start = performance.now()
  let peakRssKiB = 0
  try {
    const native = await routedNative(directory, duration)
    peakRssKiB = native.peakRssKiB
    const rows = (await readFile(`${directory}/waveform.dat`, 'utf8')).trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).map(Number))
    if (!rows.length || rows.some(row => row.length !== result.probes.length + 1 || row.some(value => !Number.isFinite(value))) || rows.at(-1)![0] < duration * .999) throw new Error('Incomplete/nonfinite receiver waveform')
    await writeFile(`${directory}/receiver.csv`, ['time_s,' + result.probes.join(','), ...rows.map(row => row.join(','))].join('\n') + '\n')
    await writeFile(`${directory}/result.json`, JSON.stringify({ status: 'candidate-unqualified', native_peak_rss_kib: peakRssKiB, convergence: 'not evaluated', hashes, mode, label: 'JLC standard stackup (assumed)', timings: { preparation_ms: preparationMs, ...result.timings, transient_ms: performance.now() - start }, samples: rows.length,
      receiver_ranges_v: result.probes.map((probe, i) => ({ probe, min: Math.min(...rows.map(row => row[i + 1])), max: Math.max(...rows.map(row => row[i + 1])) })) }, null, 2))
    console.log(`Completed ${mode} transient in ${((performance.now() - start) / 1000).toFixed(3)} s; ${rows.length} native samples`)
  } catch (error) {
    peakRssKiB = (error as { nativePeakRssKiB?: number }).nativePeakRssKiB ?? peakRssKiB
    const partial = await readFile(`${directory}/waveform.dat`, 'utf8').catch(() => '')
    if (partial.trim().split(/\r?\n/).length > 1) await writeFile(`${directory}/receiver-incomplete.csv`, ['time_s,' + result.probes.join(','), ...partial.trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).join(','))].join('\n') + '\n')
    await writeFile(`${directory}/failure.json`, JSON.stringify({ status: 'transient-failed', native_peak_rss_kib: peakRssKiB, mode, hashes, timings: { preparation_ms: preparationMs, ...result.timings, transient_ms: performance.now() - start }, error: (error as Error).message }, null, 2))
    throw error
  }
}

if (mode === 'addr-cmd' && process.env.SI_ROUTE_BATCH === '1') {
  for (const pattern of ['prbs7', 'victim-even', 'victim-odd'] as const) await capture(pattern, `${directory}/${pattern === 'prbs7' ? 'before' : pattern}`)
} else await capture(pattern, directory)
