import React from 'react'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { RoutedPipelineSolver, RoutedStageSolver } from '../src/pipeline'
import { routeGraph, routePartitions, partitionNetworkInput, RouteNetworkSolver, type RouteGraph, type RouteNetworkInput, type RoutedDeck, type RoutePartition } from '../src/simulation'
import { routedRequest } from '../src/simulation/route-transient'
import { spiceProbeRows, sampleVoltage } from '../src/observation'
import { renderCoreSignals } from '../tests/support/core-render'
import { TwoTraceBoard } from '../examples/routed/two-trace-board'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'
import Differential from '../examples/level1-differential/level1-differential'
import Two from '../examples/level2-two-channels/level2-two-channels'
import Three from '../examples/level3-three-channels/level3-three-channels'

Object.assign(globalThis, { React })
const output = resolve(process.env.SI_GROUPS_DIR ?? '.cache/coupling-groups')
const phase = process.argv[2]
const selection = process.argv[3] ?? 'small'
const thresholds = [.01, .03, .1]
interface Case { kind: string; plan?: RoutePartition; path: string; sha: string; cells: unknown; bytes: number; duration: number; probes: RoutedDeck['probes'] }
interface Block { name: string; blockName: string; graph: RouteGraph; cases: Case[] }
interface NativeRun { wallSeconds: number; timedOut: boolean; samples: number; lastTimeSeconds: number | null }
interface Measurement { native: NativeRun; samples?: number[][]; error?: string; path: string }

/** Lossless local artifacts can contain board and vendor data and must never be committed. */
async function save(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2))
}

/** Compile existing TSX declarations through the same five non-native stages, then project their solved inputs. */
async function compile(): Promise<void> {
  const files = selection === 'ddr' ? ['sprm552c.ibs', 'W631GG6MB-12.ibs'] : ['sn74lvc1g04.ibs', 'sn65hvd72.ibs']
  const ibisSources = Object.fromEntries(await Promise.all(files.map(async file => [`models/${file}`, await readFile(join(process.env.IBIS_MODEL_DIR ?? 'models', file), 'utf8') ])))
  const boards = selection === 'ddr'
    ? [['ddr', await withDdr3Signals(JSON.parse(await readFile(process.env.SI_DDR3_BOARD!, 'utf8')), ibisSources, { block: 'DDR3_ADDR_CMD' })]] as const
    : await Promise.all(([['two-trace', <TwoTraceBoard />], ['level1-differential', <Differential />], ['level2', <Two />], ['level3', <Three />]] as const).map(async ([name, tree]) => [name, await renderCoreSignals(tree)] as const))
  const manifest: Block[] = []
  for (const [name, circuitJson] of boards) {
    const root = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, { progress: console.log, runSolver: async (): Promise<never> => {
      throw new Error('Compile only')
    } })
    root.solveUntilStage('RouteTransientSolver')
    const inputs = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0]
    for (const [index, original] of inputs.entries()) {
      const units = Number(process.env.SI_GROUPS_UI_COUNT ?? 8)
      const divisor = Number(process.env.SI_GROUPS_STEP_DIVISOR ?? 1)
      if (![units, divisor].every(value => Number.isFinite(value) && value >= 1)) throw new Error('Positive UI count and timestep divisor >= 1 required')
      const durationSeconds = selection === 'ddr' ? 1e-9 : process.env.SI_GROUPS_SHORT_WINDOWS === '1' ? name === 'level1-differential' ? units * 4e-6 : name === 'two-trace' ? 40e-9 : units * 50e-9 : original.options.durationSeconds
      const stepSeconds = original.options.stepSeconds / divisor
      const input = { ...original, options: { ...original.options, durationSeconds, stepSeconds } }
      let compiled = root.stageOutput('RouteNetworkSolver').value[index]
      const deck = compiled.deck.replace(/^\.tran .+$/m, `.tran ${stepSeconds} ${durationSeconds} 0 ${stepSeconds}`)
      compiled = { ...compiled, deck, durationSeconds, stepSeconds, requestSha256: createHash('sha256').update(JSON.stringify(routedRequest({ deck }))).digest('hex') }
      const graph = routeGraph(input, compiled)
      const selected = new Set(input.bindings.mappings.map(mapping => mapping.sourceTraceId))
      const windows = thresholds.flatMap(threshold => routePartitions(graph, 'victim-window', threshold, selection === 'ddr' ? 1.5 : 3.3, .02))
        .filter(plan => graph.nets.find(net => net.id === plan.victim)?.sources.some(source => selected.has(source)))
      const plans = routePartitions(graph, 'exact').concat(windows)
      const block: Block = { name: `${name}-${index}`, blockName: compiled.name, graph, cases: [] }
      const seen = new Map<string, RoutedDeck>()
      for (const [i, plan] of [undefined, ...plans].entries()) {
        const key = plan?.nets.join(',') ?? 'full'
        let result = seen.get(key)
        if (!result) {
          if (!plan) result = compiled
          else {
            const network = new RouteNetworkSolver(partitionNetworkInput(input, graph, plan))
            network.solve()
            result = network.getOutput().value
          }
          seen.set(key, result)
        }
        const path = join(output, `${block.name}-${i}`)
        await mkdir(path, { recursive: true })
        await writeFile(join(path, 'simulation.cir'), result.deck)
        await save(join(path, 'probes.json'), result.probes)
        block.cases.push({ kind: plan?.mode ?? 'full', plan, path, sha: createHash('sha256').update(result.deck).digest('hex'), cells: result.evidence.cells, bytes: Buffer.byteLength(result.deck), duration: result.durationSeconds, probes: result.probes })
        console.log('Compiled', block.name, i, plan?.nets.length, result.evidence.cells)
      }
      manifest.push(block)
      await save(join(output, `${selection}-manifest.json`), manifest)
      await save(join(output, `${block.name}-input.json`), input)
      await save(join(output, `${block.name}-compiled.json`), compiled)
    }
  }
}

/** Invoke the lock-owning helper; its timer starts after lock acquisition, and every ngspice child has a hard deadline. */
async function measure(row: Case): Promise<Measurement> {
  if (!process.env.SI_NGSPICE_LOCK) throw new Error('Set SI_NGSPICE_LOCK to the shared machine-wide lock script')
  const timeout = Number(process.env.SI_GROUPS_TIMEOUT_SECONDS ?? (selection === 'ddr' ? 600 : 90))
  execFileSync('python3', [join(import.meta.dirname, 'research-coupling-native.py'), row.path, String(timeout)], { stdio: 'inherit' })
  const native = JSON.parse(await readFile(join(row.path, 'native.json'), 'utf8')) as NativeRun
  try {
    if (native.timedOut) throw new Error('Native hard timeout; incomplete capture')
    const logs = await readFile(join(row.path, 'stdout.log'), 'utf8') + await readFile(join(row.path, 'stderr.log'), 'utf8')
    const diagnostic = logs.split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
    if (diagnostic) throw new Error(diagnostic)
    const samples = spiceProbeRows(await readFile(join(row.path, 'waveform.raw'), 'utf8'), row.probes)
    if (Math.abs(samples.at(-1)![0] - row.duration) > row.duration * 1e-8) throw new Error('Incomplete duration')
    return { native, samples, path: row.path }
  } catch (error) {
    return { native, error: String(error), path: row.path }
  }
}

/** Compare actual adaptive native traces on the union of their time grids; duplicate deck bytes share one measured run. */
async function compare(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(output, `${selection}-manifest.json`), 'utf8')) as Block[]
  const seen = new Map<string, Measurement>()
  const results = []
  for (const block of manifest) {
    let full: Measurement | undefined
    for (const row of block.cases) {
      const run = seen.get(row.sha) ?? await measure(row)
      seen.set(row.sha, run)
      if (row.kind === 'full') full = run
      const errors: { name: string; maxErrorMv: number }[] = []
      if (run.samples && full?.samples) {
        const times = [...new Set([...run.samples, ...full.samples].map(sample => sample[0]))].sort((a, b) => a - b)
        for (const [i, probe] of row.probes.entries()) {
          const column = block.cases[0].probes.findIndex(other => other.simulationVoltageProbeId === probe.simulationVoltageProbeId) + 1
          if (!column) continue
          errors.push({ name: probe.name, maxErrorMv: 1000 * times.reduce((maximum, time) => Math.max(maximum, Math.abs(sampleVoltage(run.samples!, i + 1, time) - sampleVoltage(full!.samples!, column, time))), 0) })
        }
      }
      results.push({ block: block.name, blockName: block.blockName, kind: row.kind, plan: row.plan, cells: row.cells, bytes: row.bytes, native: run.native, reused: run.path !== row.path, error: run.error, probes: errors })
      await save(join(output, `${selection}-results.json`), results)
      console.log('Measured', block.name, row.kind, row.plan?.threshold, run.error ?? errors)
    }
  }
}

await mkdir(output, { recursive: true })
if (phase === 'compile') await compile()
else if (phase === 'measure') await compare()
else throw new Error('Usage: research-coupling-groups.tsx compile|measure small|ddr')
