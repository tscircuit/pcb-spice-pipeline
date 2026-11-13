import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { RoutedPipelineSolver, RoutedStageSolver } from '../src/pipeline'
import { boundScopeInput, routeScopeNets, RouteNetworkSolver, type BoundScopeRule, type RouteNetworkInput, type RoutedDeck } from '../src/simulation'
import { spiceProbeRows, sampleVoltage } from '../src/observation'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'

// Every artifact can contain local board/model data: write only to an ignored or external directory.
const output = resolve(process.env.SI_SCOPE_DIR ?? '.cache/bound-signal-scope')
const phase = process.argv[2]
/** Research rules: full scope, then explicit handling of the unbound passive neighbours. */
const rules: Record<string, BoundScopeRule | undefined> = {
  full: undefined,
  drop: { couplingThreshold: Infinity },
  fold: { couplingThreshold: Infinity, foldRemoved: true },
  'k-0': { couplingThreshold: 0 },
  'k-0.1': { couplingThreshold: .1 },
  'k-0.1-fold': { couplingThreshold: .1, foldRemoved: true },
  'k-0.03': { couplingThreshold: .03 },
  'k-0.1-z0': { couplingThreshold: .1, terminateKept: true },
  z0: { terminateKept: true },
}
// The first switching coefficient changes at 2.5 ns; shift every PWL schedule so it changes at 0.05 ns.
const shiftSeconds = 2.45e-9
const windows = { quiet: { stop: 1e-9, shift: 0 }, edge: { stop: 1.05e-9, shift: shiftSeconds } }
interface NativeRun { wallSeconds: number; timedOut: boolean; exitCode: number; samples: number; lastTimeSeconds: number | null; progress: [number, number, number][]; maxRssBytes: number }

/** Compile the full DDR addr/cmd scope once and keep the solved network input for every scope rule. */
async function compile(): Promise<void> {
  const directory = process.env.IBIS_MODEL_DIR ?? 'models'
  const ibisSources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(join(directory, file), 'utf8')])))
  const physical = JSON.parse(await readFile(process.env.SI_DDR3_BOARD ?? join(directory, 'ddr3-board.json'), 'utf8'))
  const circuitJson = await withDdr3Signals(physical, ibisSources, { block: 'DDR3_ADDR_CMD' })
  const started = performance.now()
  const root = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, { progress: console.log, runSolver: async (): Promise<never> => {
    throw new Error('Compile only')
  } })
  root.solveUntilStage('RouteTransientSolver')
  const input = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0]
  const compiled = root.stageOutput('RouteNetworkSolver').value[0]
  await writeFile(join(output, 'network-input.json'), JSON.stringify(input))
  console.log('Compiled', { seconds: (performance.now() - started) / 1000, cells: compiled.evidence.cells, bytes: Buffer.byteLength(compiled.deck) })
}

/** Shift every PWL schedule earlier by a uniform interval, holding its value at the new origin. */
function advance(deck: string, shift: number): string {
  if (!shift) return deck
  return deck.replace(/PWL\(([^)]*)\)/g, (_, body: string) => {
    const values = body.trim().split(/\s+/).map(Number)
    const points: [number, number][] = []
    for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]])
    const after = points.findIndex(([time]) => time > shift)
    if (after < 1) throw new Error('PWL schedule changes before the advanced origin')
    const [[t0, v0], [t1, v1]] = [points[after - 1], points[after]]
    const origin = v0 + (v1 - v0) * (shift - t0) / (t1 - t0)
    return `PWL(0 ${origin} ${points.slice(after).map(([time, value]) => `${Number((time - shift).toPrecision(12))} ${value}`).join(' ')})`
  })
}

/** Count top-level and subcircuit mutual inductors. */
function mutualCount(deck: string): number {
  return deck.split('\n').filter(line => /^K/i.test(line.trim())).length
}

/** Emit every rule's deck for both windows, with its size and the omitted oblique C. */
async function decks(): Promise<void> {
  const input = JSON.parse(await readFile(join(output, 'network-input.json'), 'utf8')) as RouteNetworkInput
  const nets = routeScopeNets(input)
  await writeFile(join(output, 'nets.json'), JSON.stringify(nets, null, 2))
  const selected = process.argv.slice(3)
  const previous = JSON.parse(await readFile(join(output, 'decks.json'), 'utf8').catch(() => '[]')) as { name: string; fullObliqueF?: number }[]
  let fullOblique = previous.find(row => row.name === 'full')?.fullObliqueF ?? 0
  const build = Object.entries(rules).filter(([name]) => !selected.length || name === 'full' && !fullOblique || selected.includes(name))
  const summary = previous.filter(row => !build.some(([name]) => name === row.name)) as Record<string, unknown>[]
  for (const [name, rule] of build) {
    const solver = new RouteNetworkSolver(rule ? boundScopeInput(input, rule) : input)
    solver.solve()
    const compiled = solver.getOutput().value
    const oblique = (compiled.evidence.oblique_encounters as { capacitanceF?: number }[]).reduce((total, record) => total + (record.capacitanceF ?? 0), 0)
    if (!rule) fullOblique = oblique
    const kept = nets.filter(net => net.bound || !rule || rule.couplingThreshold === undefined || net.coupling > rule.couplingThreshold)
    for (const [window, { stop, shift }] of Object.entries(windows)) {
      if (selected.length && !selected.includes(name)) continue
      const path = join(output, name, window)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'simulation.cir'), advance(compiled.deck, shift).replace(/^\.tran .+$/m, `.tran ${compiled.stepSeconds} ${stop} 0 ${compiled.stepSeconds}`))
      await writeFile(join(path, 'probes.json'), JSON.stringify(compiled.probes))
    }
    const row = { name, rule, nets: kept.length, unbound: kept.filter(net => !net.bound).length, cells: compiled.evidence.cells, mutualInductors: mutualCount(compiled.deck), lines: compiled.deck.split('\n').length, bytes: Buffer.byteLength(compiled.deck),
      maximumCellDelaySeconds: compiled.evidence.maximum_cell_delay_s, fullObliqueF: fullOblique, omittedObliqueF: fullOblique - oblique, terminations: compiled.deck.split('\n').filter(line => line.startsWith('RZ0T')).length }
    summary.push(row)
    console.log(row)
  }
  await writeFile(join(output, 'decks.json'), JSON.stringify(summary, null, 2))
}

/** Run one rule window under the shared lock with a hard deadline of at most 600 s. */
function measure(name: string, window: string): void {
  if (!process.env.SI_NGSPICE_LOCK) throw new Error('Set SI_NGSPICE_LOCK to the shared machine-wide lock script')
  execFileSync('python3', ['-I', join(import.meta.dirname, 'research-bound-signal-native.py'), join(output, name, window), process.env.SI_SCOPE_TIMEOUT_SECONDS ?? '600'], { stdio: 'inherit' })
}

/** Seconds per saved point within [start, stop] of simulated time, from streamed rawfile progress. */
function pointCost(run: NativeRun, start: number, stop: number): number | null {
  const inside = run.progress.filter(([, , time]) => time >= start - 1e-15 && time <= stop + 1e-15)
  const before = run.progress.filter(([, , time]) => time < start - 1e-15).at(-1) ?? [0, 0, 0]
  const last = inside.at(-1)
  return last && last[1] > before[1] ? (last[0] - before[0]) / (last[1] - before[1]) : null
}

/** Native outcome, window costs and probe deltas against the full deck on the full deck's reached interval. */
async function compare(): Promise<void> {
  const report: Record<string, unknown>[] = []
  /** One window's native result, its streamed samples and the first engine diagnostic. */
  const load = async (name: string, window: string): Promise<{ run: NativeRun; samples?: number[][]; probes: RoutedDeck['probes']; error?: string } | undefined> => {
    const path = join(output, name, window)
    let run: NativeRun
    try {
      run = JSON.parse(await readFile(join(path, 'native.json'), 'utf8'))
    } catch {
      return undefined
    }
    const probes = JSON.parse(await readFile(join(path, 'probes.json'), 'utf8')) as RoutedDeck['probes']
    const logs = await readFile(join(path, 'stdout.log'), 'utf8') + await readFile(join(path, 'stderr.log'), 'utf8')
    const error = run.timedOut ? 'timeout' : logs.split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
    try {
      return { run, probes, error, samples: partialRows(await readFile(join(path, 'waveform.raw'), 'utf8'), probes) }
    } catch (failure) {
      return { run, probes, error: error ?? String(failure) }
    }
  }
  for (const window of Object.keys(windows) as (keyof typeof windows)[]) {
    const full = await load('full', window)
    for (const name of Object.keys(rules)) {
      const result = await load(name, window)
      if (!result) continue
      const reach = Math.min(result.run.lastTimeSeconds ?? 0, full?.run.lastTimeSeconds ?? 0)
      const deltas = result.samples && full?.samples && name !== 'full' ? result.probes.map((probe, i) => {
        const column = full.probes.findIndex(other => other.simulationVoltageProbeId === probe.simulationVoltageProbeId) + 1
        const times = [...new Set([...result.samples!, ...full.samples!].map(sample => sample[0]))].filter(time => time <= reach).sort((a, b) => a - b)
        return { name: probe.name, maxDeltaMv: 1000 * times.reduce((maximum, time) => Math.max(maximum, Math.abs(sampleVoltage(result.samples!, i + 1, time) - sampleVoltage(full.samples!, column, time))), 0) }
      }) : []
      const edge = windows[window].shift ? .05e-9 : 0
      report.push({ name, window, complete: !result.error && Math.abs((result.run.lastTimeSeconds ?? 0) - windows[window].stop) < 1e-15, error: result.error, wallSeconds: result.run.wallSeconds, samples: result.run.samples, lastTimeSeconds: result.run.lastTimeSeconds, maxRssBytes: result.run.maxRssBytes,
        setupSeconds: result.run.progress[0]?.[0] ?? null, amortizedSecondsPerPoint: result.run.samples ? result.run.wallSeconds / result.run.samples : null,
        secondsPerPoint: pointCost(result.run, edge || (result.run.progress[0]?.[2] ?? 0) + 1e-18, windows[window].stop), comparedThroughSeconds: deltas.length ? reach : null, maxDeltaMv: deltas.length ? Math.max(...deltas.map(delta => delta.maxDeltaMv)) : null, deltas })
      console.log(report.at(-1))
    }
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
}

/** Complete ASCII rawfile points, including a timed-out run's streamed prefix. */
function partialRows(raw: string, probes: RoutedDeck['probes']): number[][] {
  const split = raw.indexOf('Values:')
  const header = raw.slice(0, split)
  const count = Number(/No\. Variables:\s*(\d+)/.exec(header)![1])
  const tokens = raw.slice(split + 'Values:'.length).trim().split(/\s+/)
  const points = Math.floor(tokens.length / (count + 1))
  const body = tokens.slice(0, points * (count + 1)).join('\n')
  return spiceProbeRows(`${header.replace(/No\. Points:\s*\d+/, `No. Points: ${points}`)}Values:\n${body}\n`, probes)
}

await mkdir(output, { recursive: true })
if (phase === 'compile') await compile()
else if (phase === 'decks') await decks()
else if (phase === 'measure') measure(process.argv[3], process.argv[4])
else if (phase === 'compare') await compare()
else throw new Error('Usage: research-bound-signal-scope.tsx compile|decks|measure <rule> <quiet|edge>|compare')
