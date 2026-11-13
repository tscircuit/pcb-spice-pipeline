import React from 'react'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RoutedPipelineSolver } from '../src/pipeline'
import { RouteNetworkSolver, type RouteNetworkInput, type RoutedDeck } from '../src/simulation'
import type { CircuitJson } from '../src/board'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'
import { TwoTraceBoard } from '../examples/routed/two-trace-board'
import Differential from '../examples/level1-differential/level1-differential'
import { renderCoreSignals } from '../tests/support/core-render'

// Research runner for docs/research/inverse-inductance.md. Decks, raw files and logs stay in the ignored output directory.
// Usage: bun scripts/research-inverse-inductance.tsx <two|differential|ddr> [quiet|edge]
// Env: IBIS_MODEL_DIR, SI_DDR3_BOARD, SI_NGSPICE (command prefix, e.g. a machine lock), SI_NATIVE_SECONDS, SI_RESEARCH_DIR,
// SI_THRESHOLDS (comma list: 'k' = coupled-inductor baseline, 'k<t>' = baseline without route K lines of |k| <= t,
// '<t>' = susceptance truncated at t), SI_WINDOW_SECONDS, SI_SHIFT_SECONDS.
const board = process.argv[2]
const windowName = process.argv[3] ?? 'full'
const models = process.env.IBIS_MODEL_DIR ?? 'models'
const output = resolve(process.env.SI_RESEARCH_DIR ?? '.cache/inverse-inductance', `${board}-${windowName}`)
const nativeSeconds = Number(process.env.SI_NATIVE_SECONDS ?? 600)
const prefix = (process.env.SI_NGSPICE ?? '').split(' ').filter(Boolean)
const variants = (process.env.SI_THRESHOLDS ?? 'k,0,0.001,0.01,0.03,0.1').split(',')

/** Render one example board through the real TSX and pipeline compiler, up to its network stage input. */
async function networkInput(): Promise<RouteNetworkInput> {
  let circuitJson: CircuitJson
  let ibisSources: Record<string, string>
  if (board === 'ddr') {
    ibisSources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(join(models, file), 'utf8')])))
    circuitJson = await withDdr3Signals(JSON.parse(await readFile(process.env.SI_DDR3_BOARD ?? join(models, 'ddr3-board.json'), 'utf8')) as CircuitJson, ibisSources, { block: 'DDR3_ADDR_CMD' })
  } else if (board === 'two') {
    ibisSources = { 'models/sn74lvc1g04.ibs': await readFile(join(models, 'sn74lvc1g04.ibs'), 'utf8') }
    circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  } else {
    ibisSources = { 'models/sn65hvd72.ibs': await readFile(join(models, 'sn65hvd72.ibs'), 'utf8') }
    circuitJson = await renderCoreSignals(<Differential />)
  }
  const root = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, { progress: () => undefined, runSolver: async () => Promise.reject(new Error('compile only')) })
  root.solveUntilStage('RouteNetworkSolver')
  const plan = root.stageOutput('RoutedAdmissionSolver').value[0]
  const extracted = root.stageOutput('RouteFieldsSolver').value[0]
  return { blockId: plan.id, name: plan.name, geometry: root.stageOutput('RouteSectionsSolver').value[0].geometry, extracted, bindings: root.stageOutput('RouteBindingsSolver').value[0],
    materials: extracted.materials, options: plan.bindings.options, warnings: plan.warnings, artifactPrefix: plan.sections.artifactPrefix }
}

/** Time-translate every PWL source and bound the transient; the shifted prefix is a DC hold, so the edge response is unchanged. */
function windowDeck(deck: string, durationSeconds: number, shiftSeconds: number, stepSeconds: number): string {
  return deck.split('\n').map(line => {
    if (line.startsWith('.tran ')) return `.tran ${stepSeconds} ${durationSeconds} 0 ${stepSeconds}`
    return line.replace(/PWL\(([^)]*)\)/, (_, body: string) => {
      const values = body.trim().split(/\s+/).map(Number)
      const points = values.map((value, i) => i % 2 ? value : Math.max(0, value - shiftSeconds))
      if (values.some((value, i) => i % 2 === 0 && value > 0 && value <= shiftSeconds)) throw new Error('PWL changes inside the shifted prefix')
      return `PWL(${points.join(' ')})`
    })
  }).join('\n')
}

/** L-space control: drop weak route-ladder K lines; Gershgorin keeps a diagonally dominant L positive definite. */
function truncateCouplings(deck: string, threshold: number): string {
  return deck.split('\n').filter(line => !/^KARC/.test(line) || Math.abs(Number(line.split(' ')[3])) > threshold).join('\n')
}

/** Tolerant ASCII raw reader: a timed-out batch run keeps every completed point. Ground is the implicit zero column. */
function rawRows(text: string, probes: { signalNode: string; referenceNode: string }[]): { time: number[]; values: number[][] } {
  const names = [...text.matchAll(/^\t(\d+)\t(\S+)\t/gm)].map(match => match[2].toLowerCase())
  /** Column of one saved node, or -1 for ground. */
  const column = (node: string): number => node === '0' ? -1 : names.indexOf(`v(${node.toLowerCase()})`)
  const columns = probes.map(probe => [column(probe.signalNode), column(probe.referenceNode)])
  const body = text.split(/^Values:\n/m)[1] ?? ''
  const numbers = body.split(/\s+/).filter(Boolean)
  const width = names.length + 1
  const time: number[] = []
  const values: number[][] = probes.map(() => [])
  /** Saved node voltage at one raw row. */
  const voltage = (start: number, index: number): number => index < 0 ? 0 : Number(numbers[start + 1 + index])
  for (let start = 0; start + width <= numbers.length; start += width) {
    time.push(Number(numbers[start + 1]))
    for (const [i, [signal, referenceColumn]] of columns.entries()) values[i].push(voltage(start, signal) - voltage(start, referenceColumn))
  }
  return { time, values }
}

/** One machine-serialized ngspice process whose own runtime, not its lock wait, is bounded by SIGALRM. */
function runNative(folder: string): Promise<{ exitCode: number | null; stdout: string; stderr: string; wallSeconds: number }> {
  return new Promise((done, reject) => {
    const command = [...prefix, 'perl', '-MTime::HiRes=time', '-e', 'print STDERR "native-start ", time, "\n"; alarm shift; exec @ARGV', String(nativeSeconds), 'ngspice', '-n', '-b', '-r', 'waveform.raw', 'simulation.cir']
    const child = spawn(command[0], command.slice(1), { cwd: folder, env: { ...process.env, OMP_NUM_THREADS: '1', SPICE_ASCIIRAWFILE: '1' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', exitCode => done({ exitCode, stdout, stderr, wallSeconds: Date.now() / 1000 - Number(/native-start (\S+)/.exec(stderr)?.[1]) }))
  })
}

/** Linear interpolation of a waveform onto reference timestamps inside its covered interval. */
function sample(time: number[], values: number[], at: number): number {
  let low = 0
  let high = time.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (time[middle] <= at) low = middle
    else high = middle
  }
  const span = time[high] - time[low]
  return span > 0 ? values[low] + (values[high] - values[low]) * (at - time[low]) / span : values[low]
}

const input = await networkInput()
const refined = board === 'ddr' ? {} : { refinement: 4, cellsPerRise: 40 }
const results: Record<string, unknown>[] = []
let reference: { time: number[]; values: number[][] } | undefined
for (const variant of variants) {
  const started = performance.now()
  const inductance = variant.startsWith('k')
  const network = new RouteNetworkSolver({ ...input, options: { ...input.options, ...refined, ...(inductance ? {} : { susceptanceThreshold: Number(variant) }) } })
  network.solve()
  if (!network.solved) throw new Error(`${variant}: ${network.error}`)
  const compiled: RoutedDeck = network.getOutput().value
  const compileMs = performance.now() - started
  // The edge window keeps 50 ps of DC hold before the first 2.5 ns transition, then 1 ns of switching.
  const shift = Number(process.env.SI_SHIFT_SECONDS ?? (windowName === 'edge' ? 2.45e-9 : 0))
  const duration = Number(process.env.SI_WINDOW_SECONDS ?? (windowName === 'full' ? compiled.durationSeconds : windowName === 'edge' ? 1.05e-9 : 1e-9))
  const truncated = inductance && variant.length > 1 ? truncateCouplings(compiled.deck, Number(variant.slice(1))) : compiled.deck
  const deck = windowName === 'full' ? truncated : windowDeck(truncated, duration, shift, compiled.stepSeconds)
  const folder = join(output, variant)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'simulation.cir'), deck)
  const lines = deck.split('\n')
  const census = { lines: lines.length, kLines: lines.filter(line => /^K/i.test(line)).length, inductors: lines.filter(line => /^L/i.test(line)).length,
    controlledSources: lines.filter(line => /^G/i.test(line)).length, fluxCapacitors: lines.filter(line => /^C\S*F\d+ /.test(line)).length }
  const run = await runNative(folder)
  await writeFile(join(folder, 'stdout.log'), run.stdout)
  await writeFile(join(folder, 'stderr.log'), run.stderr)
  const waveform = rawRows(await readFile(join(folder, 'waveform.raw'), 'utf8').catch(() => ''), compiled.probes)
  const analysisSeconds = Number(/Total analysis time \(seconds\) = ([\d.eE+-]+)/.exec(run.stdout)?.[1] ?? NaN)
  const completedSeconds = waveform.time.at(-1) ?? 0
  reference ??= waveform
  const overlap = Math.min(completedSeconds, reference.time.at(-1) ?? 0)
  const deltas = compiled.probes.map((probe, i) => {
    let maximum = 0
    for (const [j, at] of reference!.time.entries()) if (at <= overlap) maximum = Math.max(maximum, Math.abs(sample(waveform.time, waveform.values[i], at) - reference!.values[i][j]))
    return { probe: probe.name, maximumDeltaMv: maximum * 1000 }
  })
  const result = { variant, cells: compiled.evidence.cells, census, compileMs, exitCode: run.exitCode, timedOut: run.exitCode !== 0 && !Number.isFinite(analysisSeconds),
    diagnostic: (run.stdout + run.stderr).split('\n').find(line => /error|fatal|aborted|timestep too small/i.test(line)), analysisSeconds, wallSeconds: run.wallSeconds,
    points: waveform.time.length, completedSeconds, secondsPerPoint: (Number.isFinite(analysisSeconds) ? analysisSeconds : run.wallSeconds) / waveform.time.length, comparedThroughSeconds: overlap,
    maximumDeltaMv: Math.max(...deltas.map(delta => delta.maximumDeltaMv)), deltas }
  results.push(result)
  console.log(JSON.stringify({ ...result, deltas: undefined }))
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
}
