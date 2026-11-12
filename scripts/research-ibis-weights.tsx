import React from 'react'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bufferTables, convertIbisBuffer, cornerValue, interpolate, parseIbis, sourceHash, spiceNumber, switchingWeights } from '@tscircuit/ibis-to-spice'
import type { IbisBuffer, IbisCorner } from '@tscircuit/ibis-to-spice'
import { fitWeights } from '../src/buffers/weight-fit'
import { convertPackaged } from '../src/buffers/package'
import { modelRunDefinition } from '../src/simulation/declarations'
import { RouteNetworkSolver } from '../src/simulation/route-network'
import { RoutedPipelineSolver } from '../src/pipeline'
import type { RoutedStageSolver } from '../src/pipeline/routed-stage'
import type { RouteNetworkInput, RoutedDeck } from '../src/simulation/routed-types'
import { spiceProbeRows, sampleVoltage } from '../src/observation'
import { renderCoreSignals } from '../tests/support/core-render'
import { TwoTraceBoard } from '../examples/routed/two-trace-board'
import Differential from '../examples/level1-differential/level1-differential'

type Weights = Array<[number, number, number]>
const output = resolve(process.env.SI_IBIS_EVIDENCE ?? '.cache/ibis-weights')
const modelDirectory = process.env.IBIS_MODEL_DIR
const lock = process.env.SI_NGSPICE_LOCK
if (!modelDirectory || !lock) throw new Error('Set IBIS_MODEL_DIR, SI_NGSPICE_LOCK and SI_IBIS_EVIDENCE; never publish evidence containing vendor tables or board JSON')
await mkdir(output, { recursive: true })
const files = ['sn74lvc1g04.ibs', 'sn65hvd72.ibs', 'sprm552c.ibs', 'W631GG6MB-12.ibs']
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(modelDirectory, file), 'utf8')])) )
const documents = Object.fromEntries(files.map(file => [file, parseIbis(sources[file])]))
const sourcesByPath = Object.fromEntries(files.map(file => [`models/${file}`, sources[file]]))

/** Keep every output private and native execution serial under the shared lock. */
async function run(deck: string, directory: string, timeoutMs: number = 60000, raw: boolean = false): Promise<{ wallSeconds: number; status: number | null; capped: boolean; diagnostic?: string }> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'simulation.cir'), deck)
  const request = join(directory, 'request.json')
  await writeFile(request, JSON.stringify({ args: ['-n', '-b', ...(raw ? ['-r', 'waveform.raw'] : []), 'simulation.cir'], timeoutMs }))
  const execution = spawnSync(lock!, [process.execPath, fileURLToPath(new URL('./research-ibis-native.mjs', import.meta.url)), request], { encoding: 'utf8' })
  if (execution.status !== 0) throw new Error(`Lock/native wrapper failed: ${execution.stderr}`)
  const timing = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'))
  const logs = await readFile(join(directory, 'stdout.log'), 'utf8') + await readFile(join(directory, 'stderr.log'), 'utf8')
  return { ...timing, diagnostic: logs.split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line)) }
}

/** Native plus IBIS-knot union is the complete maximum of their PWL difference. */
function compare(left: number[][], right: number[][]): { maxMv: number; rmsMv: number }[] {
  const first = Math.max(left[0][0], right[0][0])
  const last = Math.min(left.at(-1)![0], right.at(-1)![0])
  const times = [...new Set([...left, ...right].map(row => row[0]).filter(time => time >= first && time <= last))].sort((a, b) => a - b)
  return left[0].slice(1).map((_, index) => {
    let maximum = 0
    let integral = 0
    let previous = 0
    for (const [i, time] of times.entries()) {
      const value = (sampleVoltage(left, index + 1, time) - sampleVoltage(right, index + 1, time)) * 1000
      maximum = Math.max(maximum, Math.abs(value))
      if (i) integral += (time - times[i - 1]) * (previous ** 2 + previous * value + value ** 2) / 3
      previous = value
    }
    return { maxMv: maximum, rmsMv: Math.sqrt(integral / (last - first)) }
  })
}

/** Read a wrdata table without rounding the in-memory native values further. */
async function readRows(path: string): Promise<number[][]> {
  return (await readFile(path, 'utf8')).trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number))
}

/** Record the actual two-by-two condition number, not the determinant alone. */
function conditions(buffer: IbisBuffer, corner: IbisCorner, edge: 'rising' | 'falling', weights: Weights): number[] {
  const waves = buffer.waveforms.filter(wave => wave.kind === edge).slice(0, 2)
  const tables = waves.map(wave => wave.data.map(([time, ...values]) => [time, cornerValue(values, corner, edge)] as [number, number]))
  const current = bufferTables(buffer, corner).voltage
  return weights.map(([time]) => {
    const [a, b] = tables.map(table => {
      const voltage = interpolate(table, time)
      return [interpolate(current.pu, voltage), interpolate(current.pd, voltage)]
    })
    const norm = Math.hypot(...a, ...b) ** 2
    const determinant = Math.abs(a[0] * b[1] - a[1] * b[0])
    return (norm + Math.sqrt(Math.max(0, norm ** 2 - 4 * determinant ** 2))) / (2 * determinant)
  })
}

/** Reconstruct each waveform into its own die-level resistive fixture. */
async function fixtures(): Promise<void> {
  const selected: Record<string, string[]> = {
    'sn74lvc1g04.ibs': ['LVC1G04_OUT_33'], 'sn65hvd72.ibs': ['a_b_p', 'a_b_n', 'rpin'],
    'sprm552c.ibs': ['Model_257', 'Model_579', 'Model_771', 'Model_336', 'Model_655', 'Model_847', 'Model_352', 'Model_345', 'Model_273', 'Model_343'],
    'W631GG6MB-12.ibs': ['ODT_off', 'ODT_60', 'CMD'],
  }
  const records: Record<string, unknown>[] = []
  for (const [file, models] of Object.entries(selected)) for (const model of models) {
    const document = documents[file]
    const buffer = document.getBuffer(model)
    if (buffer.type === 'input' || !buffer.pullup || !buffer.pulldown) {
      records.push({ file, model, type: buffer.type, reason: 'receiver: no extraction used' })
      continue
    }
    const windowSeconds = file === 'sprm552c.ibs' ? 10e-12 : file === 'sn65hvd72.ibs' && model !== 'rpin' ? 1e-9 : 20e-12
    for (const corner of ['typical', 'minimum', 'maximum'] as const) for (const edge of ['rising', 'falling'] as const) {
      const original = switchingWeights(buffer, corner, edge)
      const fitted = fitWeights(buffer, corner, edge, { windowSeconds, coefficientTolerance: .001 })
      const waves = buffer.waveforms.filter(wave => wave.kind === edge).slice(0, 2)
      const condition = conditions(buffer, corner, edge, original)
      const converted = convertIbisBuffer(document, model, { corner, mode: 'output', name: 'DRIVER', skipSwitchingWeights: true })
      const vt = waves.map(wave => wave.data.map(([time, ...values]) => [time, cornerValue(values, corner, edge)]))
      const record: Record<string, unknown> = { file, model, corner, edge, windowSeconds, coefficientTolerance: .001, original, fitted, condition, vt,
        sourceSha256: sourceHash(sources[file]), capacitanceFarads: cornerValue(buffer.capacitance, corner, 'C_comp'),
        fixtures: waves.map(wave => ({ resistanceOhms: wave.resistance, voltage: cornerValue(wave.fixtureVoltage, corner, 'V_fixture'), rows: wave.data.length })),
        conditionMax: Math.max(...condition), conditionMedian: [...condition].sort((a, b) => a - b)[Math.floor(condition.length / 2)],
        originalKnots: original.length, fittedKnots: fitted.length }
      for (const [variant, weights] of [['original', original], ['fitted', fitted]] as const) {
        const end = weights.at(-1)![0]
        // Fine enough to resolve the 10 ps derivative window independently of PWL knots.
        const step = Math.min(end / 10000, windowSeconds / 10)
        const lines = ['IBIS independent fixture replay', converted.source, `VDD vdd 0 ${cornerValue(buffer.voltage, corner, 'VDD')}`,
          '.options method=gear maxord=1 reltol=1e-6 abstol=1e-12 vntol=1e-8']
        for (const [index, wave] of waves.entries()) lines.push(`X${index} out${index} vdd 0 ku kd DRIVER`,
          `VFIX${index} fix${index} 0 ${cornerValue(wave.fixtureVoltage, corner, 'V_fixture')}`, `R${index} out${index} fix${index} ${wave.resistance}`)
        for (const [label, column] of [['U', 1], ['D', 2]] as const)
          lines.push(`VK${label} k${label.toLowerCase()} 0 PWL(${weights.map(row => `${spiceNumber(row[0])} ${spiceNumber(row[column])}`).join(' ')})`)
        lines.push('.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17', `tran ${step} ${end} 0 ${step}`, 'wrdata waveform.dat v(out0) v(out1)', 'rusage', 'quit', '.endc', '.end')
        const directory = join(output, 'fixtures', `${model}-${corner}-${edge}-${variant}`)
        const timing = await run(lines.join('\n'), directory)
        if (timing.status !== 0 || timing.capped || timing.diagnostic) throw new Error(`Incomplete fixture ${directory}: ${timing.diagnostic}`)
        const actual = await readRows(join(directory, 'waveform.dat'))
        if (actual.length < 2 || Math.abs(actual.at(-1)![0] - end) > end * 1e-8) throw new Error(`Truncated fixture ${directory}`)
        record[variant + 'Run'] = { ...timing, steps: actual.length, error: vt.map((table, i) => compare(actual.map(row => [row[0], row[i + 1]]), table)[0]) }
      }
      records.push(record)
      await writeFile(join(output, 'fixtures.json'), JSON.stringify(records))
      console.log(model, corner, edge, original.length, fitted.length, record.originalRun, record.fittedRun)
    }
  }
  await writeFile(join(output, 'fixtures.json'), JSON.stringify(records))
}

/** Rebind only the vendor buffers; preserve compiled geometry, packages and tolerances. */
function rebind(input: RouteNetworkInput, fitted: boolean, windowSeconds: number): RouteNetworkInput {
  const next = structuredClone(input)
  for (const [i, model] of next.bindings.plan.models.entries()) {
    const definition = modelRunDefinition(model, next.bindings.plan)
    const file = model.ibis_model_asset.project_relative_path.split('/').at(-1)!
    const converted = convertPackaged(new TextEncoder().encode(sources[file]), definition, file,
      fitted ? { windowSeconds, coefficientTolerance: .001 } : undefined)
    Object.assign(next.bindings.models[i], { source: converted.source, metadata: converted.metadata, spicePinMapping: converted.spicePinMapping, warnings: converted.warnings })
  }
  return next
}

/** Compile existing TSX boards once, then compare complete native probe unions. */
async function boards(): Promise<void> {
  const summaries: Record<string, unknown>[] = []
  for (const [name, board, windowSeconds] of [['two-trace', <TwoTraceBoard />, 20e-12], ['level1-differential', <Differential />, 1e-9]] as const) {
    const root = new RoutedPipelineSolver({ circuitJson: await renderCoreSignals(board), ibisSources: sourcesByPath, scopeDistanceMm: 1 },
      { progress: console.log, runSolver: async (): Promise<never> => { throw new Error('Compile only') } })
    root.solveUntilStage('RouteTransientSolver')
    const input = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0]
    const traces: number[][][] = []
    const variants: Record<string, unknown>[] = []
    for (const fitted of [false, true]) {
      const network = new RouteNetworkSolver(rebind(input, fitted, windowSeconds))
      network.solve()
      const compiled = network.getOutput().value
      const directory = join(output, name, fitted ? 'fitted' : 'original')
      const timing = await run(compiled.deck, directory, 120000, true)
      if (timing.status !== 0 || timing.capped || timing.diagnostic) throw new Error(`Incomplete board ${directory}: ${timing.diagnostic}`)
      const rows = spiceProbeRows(await readFile(join(directory, 'waveform.raw'), 'utf8'), compiled.probes)
      if (Math.abs(rows.at(-1)![0] - compiled.durationSeconds) > 1e-16) throw new Error(`Truncated board ${directory}`)
      traces.push(rows)
      variants.push({ fitted, ...timing, steps: rows.length, deckSha256: sourceHash(compiled.deck), probes: compiled.probes, durationSeconds: compiled.durationSeconds })
    }
    const summary = { name, windowSeconds, variants, probeErrors: compare(traces[0], traces[1]) }
    summaries.push(summary)
    await writeFile(join(output, 'boards.json'), JSON.stringify(summaries, null, 2))
    console.log(JSON.stringify(summary))
  }
}

/** Run the same large DDR deck over 0..1 ns, with a ten-minute cap on each variant. */
async function ddr(): Promise<void> {
  const path = process.env.SI_DDR_NETWORK_INPUT
  if (!path) throw new Error('SI_DDR_NETWORK_INPUT must name a saved RouteNetworkSolver input; never commit this board data')
  const input = JSON.parse(await readFile(path, 'utf8')) as RouteNetworkInput
  const summaries: Record<string, unknown>[] = []
  for (const fitted of [false, true]) {
    const network = new RouteNetworkSolver(rebind(input, fitted, 10e-12))
    network.solve()
    const compiled: RoutedDeck = network.getOutput().value
    const deck = compiled.deck.replace(/^(\.tran \S+) \S+ (.*)$/m, '$1 1e-9 $2')
    const directory = join(output, 'ddr', fitted ? 'fitted' : 'original')
    const timing = await run(deck, directory, 600000, true)
    const raw = await readFile(join(directory, 'waveform.raw'), 'utf8')
    // On timeout ngspice's ASCII raw point-count header is zero; count only
    // fully written records rather than presenting a partial capture as success.
    const width = Number(/No\. Variables:\s*(\d+)/.exec(raw)?.[1])
    const body = raw.split('Values:')[1] ?? ''
    const tokens = body.slice(0, body.lastIndexOf('\n') + 1).trim().split(/\s+/)
    const steps = width > 0 ? Math.floor(tokens.length / (width + 1)) : 0
    const finalTimeSeconds = steps ? Number(tokens[(steps - 1) * (width + 1) + 1]) : 0
    const summary = { fitted, ...timing, steps, firstTimeSeconds: steps ? Number(tokens[1]) : null, finalTimeSeconds,
      secondsPerAcceptedStep: steps ? timing.wallSeconds / steps : null, deckSha256: sourceHash(deck), networkInputSha256: sourceHash(await readFile(path)),
      pwlKnots: [...deck.matchAll(/^VK[UD]\d+ .*PWL\((.*)\)$/gm)].map(match => match[1].split(/\s+/).length / 2),
      complete: !timing.capped && !timing.diagnostic && timing.status === 0 && finalTimeSeconds >= 1e-9 * (1 - 1e-8) }
    summaries.push(summary)
    await writeFile(join(output, 'ddr.json'), JSON.stringify(summaries, null, 2))
    console.log(JSON.stringify(summary))
  }
}

const mode = process.argv[2]
if (mode === 'fixtures') await fixtures()
else if (mode === 'boards') await boards()
else if (mode === 'ddr') await ddr()
else throw new Error('Choose fixtures, boards or ddr')
