import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteTransientSolver, type RoutedDeck, routedControl } from '../../src/simulation'
import { routedRequest } from '../../src/simulation/route-transient'
import { formatSpiceVectors, probeWaveformRows, sampleVoltage } from '../../src/observation'
import { createNativeSolver } from '../../src/adapters'
import { RoutedPipelineSolver } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import type { RunSolver, SolverContext, SolverRequest, SolverResult } from '../../src/solver'

const compiled: RoutedDeck = { blockId: 'test', name: 'test', deck: 'test', requestSha256: 'test-request', durationSeconds: 1e-9, stepSeconds: 1e-11, evidence: {}, spatialPoints: [{ node: 'n1', net: 'VICTIM', layer: 'top', x: 4, y: .35 }], probes: [{ name: 'VICTIM', column: 1, simulationVoltageProbeId: 'p', signalSourceId: 'port', referenceSourceId: null, signalNode: 'n1', referenceNode: '0' }] }
/** Synthetic protocol fixture, never native waveform evidence. */
function response(times: number[] = [0, 2e-10, 1e-9], values: number[] = [0, .3, .1], stdout: string = ''): SolverResult {
  return { stdout, stderr: '', files: { 'waveform.raw': formatSpiceVectors([{ name: 'time', type: 'time', values: times }, { name: 'v(n1)', type: 'voltage', values }]) } }
}
/** Inject one synthetic response for parser and lifecycle checks. */
function solver(result: SolverResult): RouteTransientSolver {
  return new RouteTransientSolver({ compiled, artifactPrefix: 'test', context: { runSolver: async () => result, progress: (): void => undefined } })
}

test('one async step invokes once and keeps adaptive times and candidate labels', async () => {
  let calls = 0
  const stage = new RouteTransientSolver({ compiled, artifactPrefix: 'test', context: { runSolver: async request => {
    calls++
    assert.deepEqual(request, routedRequest(compiled))
    await new Promise<void>(resolve => setImmediate(resolve))
    return response()
  }, progress: (): void => undefined } })
  assert.throws(() => stage.step(), /requires stepAsync/)
  assert.throws(() => stage.getOutput(), /incomplete/)
  await stage.stepAsync()
  await stage.stepAsync()
  assert.equal(calls, 1)
  assert.equal(stage.iterations, 1)
  const output = stage.getOutput()
  assert.deepEqual(output.value.timestampsSeconds, [0, 2e-10, 1e-9])
  assert.deepEqual(output.value.probes[0].voltageLevels, [0, .3, .1])
  assert.deepEqual(output.value.spatial, { points: compiled.spatialPoints, timeSeconds: [0, 2e-10, 1e-9], volts: [[0, .3, .1]] })
  assert.equal(output.value.qualification, 'candidate-unqualified')
  assert.ok(output.artifacts.some(artifact => artifact.owner === 'solver' && artifact.path.endsWith('ngspice.request.json')))
})

for (const [label, result, pattern] of [
  ['truncated', response([0, 5e-10], [0, 1]), /did not complete/],
  ['beginning', response([5e-10, 1e-9], [0, 1]), /omits the beginning/],
  ['fatal', response(undefined, undefined, 'fatal: rejected'), /fatal/],
  ['missing vector', { stdout: '', stderr: '', files: { 'waveform.raw': response().files['waveform.raw'].replace('v(n1)', 'v(other)') } }, /Missing ngspice vector/],
  ['nonfinite', { stdout: '', stderr: '', files: { 'waveform.raw': response().files['waveform.raw'].replace('0.3', 'NaN') } }, /finite/],
] as const) test(`live transient rejects ${label} without exposing partial success`, async () => {
  const stage = solver(result)
  await assert.rejects(stage.solveAsync(), pattern)
  assert.equal(stage.failed, true)
  assert.throws(() => stage.getOutput(), /incomplete/)
})

test('engine rejection is a failed async stage without a capture', async () => {
  const stage = new RouteTransientSolver({ compiled, artifactPrefix: 'test', context: { progress: (): void => undefined, runSolver: async () => {
    throw new Error('engine unavailable')
  } } })
  await assert.rejects(stage.solveAsync(), /unavailable/)
  assert.equal(stage.failed, true)
  assert.throws(() => stage.getOutput(), /incomplete/)
})

/** Maximum piecewise-linear difference over the union of both adaptive time grids. */
function maximumDifference(left: number[][], right: number[][]): number {
  const times = [...new Set([...left, ...right].map(row => row[0]))].sort((a, b) => a - b)
  return times.reduce((maximum, time) => left[0].slice(1).reduce((value, _, i) => Math.max(value, Math.abs(sampleVoltage(left, i + 1, time) - sampleVoltage(right, i + 1, time))), maximum), 0)
}

/** The removed control deck exists only as the historical comparison oracle in this test. */
function oldControl(deck: RoutedDeck): string {
  const saved = /^\.save (.+)$/m.exec(deck.deck)![1]
  const cuts = [Math.min(1e-12, deck.durationSeconds / 4)]
  for (let time = 5e-10; time < deck.durationSeconds - 1e-15; time = Math.max(time + deck.durationSeconds / 16, time * 2)) cuts.push(time)
  const lines = ['.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17', `save ${saved}`, ...cuts.map(time => `stop when time = ${time}`)]
  for (const [index, time] of [...cuts, deck.durationSeconds].entries()) {
    lines.push(index ? 'resume' : `tran ${deck.stepSeconds} ${deck.durationSeconds} 0 ${deck.stepSeconds}`)
    for (const [i, probe] of deck.probes.entries()) lines.push(`let probe${i} = v(${probe.signalNode})${probe.referenceNode === '0' ? '' : `-v(${probe.referenceNode})`}`)
    lines.push(`wrdata waveform.dat ${deck.probes.map((_, i) => `probe${i}`).join(' ')}`, `echo SI_PROGRESS ${time}`)
  }
  return deck.deck.replace(routedControl(saved, deck.stepSeconds, deck.durationSeconds).join('\n'), [...lines, 'quit', '.endc', '.end'].join('\n'))
}

test('real TSX two-trace: old/new native deck parity', { skip: process.env.SI_NATIVE_TESTS !== '1' && 'Set SI_NATIVE_TESTS=1 and IBIS_MODEL_DIR for bounded sequential native checks' }, async context => {
  const input = await routedProblem(context, { 'bit-rate': '50Mbps', 'duration-seconds': 40e-9 })
  if (!input) return
  const port: SolverContext = { runSolver: createNativeSolver({ timeoutMs: 10_000 }), progress: (): void => undefined }
  const compiler = new RoutedPipelineSolver(input, port)
  compiler.solveUntilStage('RouteTransientSolver')
  const deck = compiler.stageOutput('RouteNetworkSolver').value[0]
  const originalStart = performance.now()
  const original = await port.runSolver({ solver: 'ngspice', files: { 'simulation.cir': oldControl(deck) }, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
  const originalMs = performance.now() - originalStart
  const oldRows = probeWaveformRows(original.files['waveform.dat'], deck.probes)
  const nativeStart = performance.now()
  await compiler.solveAsync()
  const nativeMs = performance.now() - nativeStart
  const native = compiler.getOutput().blocks[0].capture
  const nativeRows = native.timestampsSeconds.map((time, i) => [time, ...native.probes.map(probe => probe.voltageLevels[i])])
  const capture = native
  const oldNativeMaxV = maximumDifference(oldRows, nativeRows)
  assert.ok(oldNativeMaxV <= .001, `old/new native max difference ${oldNativeMaxV} V`)
  assert.equal(capture.probes.length, deck.probes.length)
  assert.equal(capture.timestampsSeconds.at(-1), 40e-9)
  assert.ok(capture.timestampsSeconds.length > 20)
  const signal = capture.probes[0].voltageLevels
  assert.ok(Math.abs(signal[0]) < .01, 'switching capture must begin low')
  assert.ok(signal.at(-1)! > 3 && signal.at(-1)! < 3.5, 'switching capture must finish near 3.3 V')
  assert.ok(Math.max(...signal) - Math.min(...signal) > 3, 'comparison must exercise a full voltage swing')
  context.diagnostic(JSON.stringify({ durationSeconds: 40e-9, bitRateHz: 50e6, signalSwingV: Math.max(...signal) - Math.min(...signal), finalSignalV: signal.at(-1), originalMs, nativeMs, oldNativeMaxV, nativeSamples: nativeRows.length }))
})


import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('live stage uses the shared waveform atlas for completed samples and failure diagnostics', async () => {
  const { root } = await routedVisualFixture()
  const stage = root.getSolver<RouteTransientSolver>('RouteTransientSolver')!
  assertRouteVisual(stage.visualize(), 'simulation', 'route-transient')
  assert.ok(stage.visualize().lines!.some(line => line.strokeColor === '#9333ea'))
  assert.ok(stage.visualize().texts!.some(text => text.text.includes('ngspice samples')))
  assert.ok(stage.visualize().texts!.some(text => text.text.includes('VICTIM_0 · RX far')))
  assert.ok(stage.visualize().texts!.some(text => text.text.includes('VICTIM_1 · TX near')))
  assert.deepEqual(root.stageOutput('RouteTransientSolver').value[0].probes.map(probe => probe.name), ['DATA_0', 'VICTIM_0', 'VICTIM_1'])
  const pending = solver(response())
  assert.ok(pending.visualize().texts!.some(text => text.text.includes('awaiting live ngspice')))
  assert.equal(pending.visualize().lines!.filter(line => line.strokeWidth === .3).length, 0)
  const failed = solver(response(undefined, undefined, 'fatal: rejected'))
  await assert.rejects(failed.solveAsync(), /fatal/)
  assert.ok(failed.visualize().texts!.some(text => text.color === '#dc2626' && text.text.includes('fatal')))
})

import React from 'react'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import Differential from '../../examples/level1-differential/level1-differential'
import { renderCoreSignals } from '../support/core-render'
import { readFile } from 'node:fs/promises'
import { createSolverMiddleware } from '../../src/adapters/solver-middleware'
import { createHttpSolver } from '../../src/adapters/browser'
import { parseSpiceVectors, spiceProbeRows } from '../../src/observation'
import { sha256 } from '../../src/kernel'

/** Interpolate the first rising threshold crossing on actual native or decimated timestamps. */
function crossing(times: readonly number[], volts: readonly number[], level: number): number {
  const index = volts.findIndex((value, i) => i > 0 && volts[i - 1] < level && value >= level)
  assert.ok(index > 0, `Missing rising ${level} V crossing`)
  return times[index - 1] + (times[index] - times[index - 1]) * (level - volts[index - 1]) / (volts[index] - volts[index - 1])
}

test('real TSX spatial capture: serial pre-spatial probe parity, physical delay and native HTTP transport', { skip: process.env.SI_SPATIAL_NATIVE_TESTS !== '1' && 'Set SI_SPATIAL_NATIVE_TESTS=1 and IBIS_MODEL_DIR for serial two-trace and differential checks' }, async context => {
  const engine = createNativeSolver({ timeoutMs: 120_000 })
  let nativeRaw = ''
  let nativeResult: SolverResult | undefined
  let nativeRequestSha256 = ''
  /** Optional local cache contains only completed native results, keyed by the complete request bytes. */
  const native: RunSolver = async (request: SolverRequest): Promise<SolverResult> => {
    nativeRequestSha256 = sha256(JSON.stringify(request))
    const file = process.env.SI_SPATIAL_NATIVE_CACHE && `${process.env.SI_SPATIAL_NATIVE_CACHE}/${sha256(JSON.stringify(request))}.json`
    if (file) {
      try {
        const result = JSON.parse(await readFile(file, 'utf8')) as SolverResult
        nativeRaw = result.files['waveform.raw']
        nativeResult = result
        return result
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const result = await engine(request)
    nativeRaw = result.files['waveform.raw']
    nativeResult = result
    if (file) await writeFile(file, JSON.stringify(result))
    return result
  }
  const middleware = createSolverMiddleware({ runSolver: async request => {
    assert.equal(sha256(JSON.stringify(request)), nativeRequestSha256, 'HTTP must transport the exact completed native request')
    assert.ok(nativeResult)
    return nativeResult
  } })
  const http = createServer((request, response) => middleware(request, response, () => response.end()))
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>(resolve => {
    http.close(() => resolve())
    http.closeAllConnections()
  }))
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  const evidence: Record<string, unknown>[] = []
  for (const [name, tree, file] of [['two-trace', <TwoTraceBoard />, 'sn74lvc1g04.ibs'], ['level1-differential', <Differential />, 'sn65hvd72.ibs']] as const) {
    let responseBytes = 0
    const httpSolver = createHttpSolver({ fetch: async (url, options) => {
      const response = await fetch(new URL(String(url), base), options)
      const text = await response.text()
      responseBytes = Buffer.byteLength(text)
      return new Response(text, { status: response.status, headers: response.headers })
    } })
    const compiler = new RoutedPipelineSolver({ circuitJson: await renderCoreSignals(tree), ibisSources: { [`models/${file}`]: await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`, 'utf8') } }, { runSolver: native, progress: (): void => undefined })
    compiler.solveUntilStage('RouteTransientSolver')
    const deck = compiler.stageOutput('RouteNetworkSolver').value[0]
    const probeNodes = new Set(deck.probes.flatMap(probe => [probe.signalNode, probe.referenceNode]))
    // Reconstruct the exact pre-spatial .save line; every electrical element and transient option stays identical.
    const baseline = deck.deck.replace(/^\* Routed probe (?:nodes|pairs): .+\n/gm, '').replace(/^\.save (.+)$/m, (_line, save: string) => `.save ${save.split(' ').filter(name => !name.startsWith('v(') || probeNodes.has(name.slice(2, -1))).join(' ')}`)
    if (name === 'two-trace') assert.equal(sha256(baseline), '555f72a50ff66adda88251833e0d108825d8f13dbf3aa8b2f36b23e7cb77ee0a')
    const before = await native(routedRequest({ deck: baseline }))
    const beforeRows = spiceProbeRows(before.files['waveform.raw'], deck.probes)
    await compiler.solveAsync()
    const capture = compiler.getOutput().blocks[0].capture
    assert.equal(capture.timestampsSeconds.length, beforeRows.length, 'Node API retains every native probe sample')
    const browserStage = new RouteTransientSolver({ compiled: deck, artifactPrefix: 'browser', context: { runSolver: httpSolver, progress: (): void => undefined } })
    await browserStage.solveAsync()
    const browser = browserStage.getOutput().value
    assert.equal(browser.timestampsSeconds.length, Math.min(5000, capture.timestampsSeconds.length))
    assert.equal(browser.timestampsSeconds[0], capture.timestampsSeconds[0])
    assert.equal(browser.timestampsSeconds.at(-1), capture.timestampsSeconds.at(-1))
    assert.deepEqual(browser.spatial, capture.spatial, 'spatial cap and samples are independent of browser probe reduction')
    for (const [i, probe] of capture.probes.entries()) {
      assert.equal(browser.probes[i].voltageLevels.reduce((value, sample) => Math.min(value, sample), Infinity), probe.voltageLevels.reduce((value, sample) => Math.min(value, sample), Infinity))
      assert.equal(browser.probes[i].voltageLevels.reduce((value, sample) => Math.max(value, sample), -Infinity), probe.voltageLevels.reduce((value, sample) => Math.max(value, sample), -Infinity))
    }
    const afterRows = capture.timestampsSeconds.map((time, i) => [time, ...capture.probes.map(probe => probe.voltageLevels[i])])
    const maximumProbeDifferenceV = maximumDifference(beforeRows, afterRows)
    assert.ok(maximumProbeDifferenceV <= .0001, `${name}: pre-spatial probe difference ${maximumProbeDifferenceV} V`)
    const spatial = capture.spatial
    assert.ok(spatial.points.length > 0 && spatial.points.length <= 2000)
    assert.ok(spatial.timeSeconds.length > 0 && spatial.timeSeconds.length <= 1000)
    assert.ok(spatial.volts.every(vector => vector.length === spatial.timeSeconds.length))
    assert.ok(spatial.volts.flat().every(Number.isFinite))
    assert.equal(spatial.timeSeconds.at(-1), deck.durationSeconds)
    assert.ok(Buffer.byteLength(JSON.stringify(spatial)) < 2_000_000)
    assert.ok(responseBytes < 1_000_000, `${name}: compact HTTP response ${responseBytes} bytes`)
    let delay: Record<string, number> | undefined
    if (name === 'two-trace') {
      const start = spatial.points.findIndex(point => point.net === 'DATA' && Math.abs(point.x + 4) < 1e-6)
      const end = spatial.points.findIndex(point => point.net === 'DATA' && Math.abs(point.x - 4) < 1e-6)
      assert.ok(start >= 0 && end >= 0)
      const vectors = new Map(parseSpiceVectors(nativeRaw).map(vector => [vector.name, vector.values]))
      const times = vectors.get('time')!
      const driver = vectors.get(`v(${spatial.points[start].node})`)!
      const receiver = vectors.get(`v(${spatial.points[end].node})`)!
      const driverCrossingSeconds = crossing(times, driver, 1.65)
      const receiverCrossingSeconds = crossing(times, receiver, 1.65)
      const driverDepartureSeconds = crossing(times, driver, driver[0] + .02 * (driver.at(-1)! - driver[0]))
      const receiverDepartureSeconds = crossing(times, receiver, receiver[0] + .02 * (receiver.at(-1)! - receiver[0]))
      const departureGapSeconds = receiverDepartureSeconds - driverDepartureSeconds
      assert.ok(departureGapSeconds > 0, 'physical receiver departure follows driver departure')
      const fields = compiler.stageOutput('RouteFieldsSolver').value[0]
      const source = (deck.evidence.routes as { port: string; sourceTraceId: string }[]).find(route => route.port === 'DATA')!.sourceTraceId
      const expectedSeconds = fields.slices.reduce((sum, slice) => sum + slice.wires.reduce((total, wire, i) => total + (wire.source === source ? (slice.end - slice.start) / 1000 * Math.sqrt(slice.line.L[i][i] * slice.line.C[i][i]) : 0), 0), 0)
      const measuredSeconds = receiverCrossingSeconds - driverCrossingSeconds
      const spatialSeconds = crossing(spatial.timeSeconds, spatial.volts[end], 1.65) - crossing(spatial.timeSeconds, spatial.volts[start], 1.65)
      // The loaded, slow IBIS edge need not cross mid-supply one unloaded flight time later. Report both without fitting the electrical network.
      assert.ok(measuredSeconds > 0, `Driver must cross before receiver: ${measuredSeconds} s`)
      assert.ok(spatialSeconds > 0 && Math.abs(spatialSeconds - measuredSeconds) < 5e-12)
      // Bounded sensitivity check: retain the PCB pad and route, remove only the receiver IBIS/package instance.
      const receiverInstance = deck.deck.split('\n').find(line => line.startsWith('XIBIS') && line.split(' ').slice(1, -1).includes(spatial.points[end].node))!.split(' ')[0]
      const unloadedDeck = deck.deck.split('\n').filter(line => !line.startsWith(`${receiverInstance} `)).map(line => line.startsWith('.save ') ? line.split(' ').filter(vector => !vector.toLowerCase().includes(`v.${receiverInstance.toLowerCase()}.`)).join(' ') : line).join('\n')
      const unloaded = await native(routedRequest({ deck: unloadedDeck }))
      const unloadedVectors = new Map(parseSpiceVectors(unloaded.files['waveform.raw']).map(vector => [vector.name, vector.values]))
      const unloadedTimes = unloadedVectors.get('time')!
      const unloadedDriver = unloadedVectors.get(`v(${spatial.points[start].node})`)!
      const unloadedReceiver = unloadedVectors.get(`v(${spatial.points[end].node})`)!
      const unloadedDepartureSeconds = crossing(unloadedTimes, unloadedReceiver, unloadedReceiver[0] + .02 * (unloadedReceiver.at(-1)! - unloadedReceiver[0])) - crossing(unloadedTimes, unloadedDriver, unloadedDriver[0] + .02 * (unloadedDriver.at(-1)! - unloadedDriver[0]))
      assert.ok(unloadedDepartureSeconds < departureGapSeconds / 5, 'receiver input/package response dominates the loaded departure-gap metric')
      delay = { driverCrossingSeconds, receiverCrossingSeconds, measuredSeconds, expectedSeconds, spatialSeconds, driverDepartureSeconds, receiverDepartureSeconds, departureGapSeconds, unloadedDepartureSeconds }
    }
    const measured = { name, points: spatial.points.length, timeSamples: spatial.timeSeconds.length, probeSamples: capture.timestampsSeconds.length, browserProbeSamples: browser.timestampsSeconds.length, browserCaptureBytes: Buffer.byteLength(JSON.stringify(browser)), probeExtremaPreserved: true, spatialBytes: Buffer.byteLength(JSON.stringify(spatial)), captureBytes: Buffer.byteLength(JSON.stringify(capture)), httpResponseBytes: responseBytes, maximumProbeDifferenceV, baselineDeckSha256: sha256(baseline), spatialDeckSha256: sha256(deck.deck), delay }
    evidence.push(measured)
    context.diagnostic(JSON.stringify(measured))
  }
  if (process.env.SI_SPATIAL_EVIDENCE) await writeFile(process.env.SI_SPATIAL_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n')
})
