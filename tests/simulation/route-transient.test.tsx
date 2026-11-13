import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteTransientSolver, type RoutedDeck, routedControl } from '../../src/simulation'
import { routedRequest } from '../../src/simulation/route-transient'
import { formatSpiceVectors, probeWaveformRows, sampleVoltage } from '../../src/observation'
import { createNativeSolver } from '../../src/adapters'
import { RoutedPipelineSolver } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import type { SolverContext, SolverResult } from '../../src/solver'

const compiled: RoutedDeck = { blockId: 'test', name: 'test', deck: 'test', requestSha256: 'test-request', durationSeconds: 1e-9, stepSeconds: 1e-11, evidence: {}, probes: [{ name: 'VICTIM', column: 1, simulationVoltageProbeId: 'p', signalSourceId: 'port', referenceSourceId: null, signalNode: 'n1', referenceNode: '0' }] }
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
  return Math.max(...times.flatMap(time => left[0].slice(1).map((_, i) => Math.abs(sampleVoltage(left, i + 1, time) - sampleVoltage(right, i + 1, time)))))
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
import { routeTones } from '../../src/board'

test('live stage uses the shared waveform atlas for completed samples and failure diagnostics', async () => {
  const { root } = await routedVisualFixture()
  const stage = root.getSolver<RouteTransientSolver>('RouteTransientSolver')!
  assertRouteVisual(stage.visualize(), 'simulation', 'route-transient')
  const curves = stage.visualize().lines!.filter(line => line.label)
  assert.deepEqual(curves.map(line => [line.label, Boolean(line.strokeDash)]), [['DATA_0', false], ['VICTIM_0', false], ['VICTIM_1', true]], 'the near-end probe is dashed')
  assert.equal(new Set(curves.map(line => line.strokeColor)).size, 2, 'curves take their net colour')
  assert.ok(stage.visualize().texts!.every(text => / (V|ns)$/.test(text.text)), 'only axis ticks are written')
  assert.deepEqual(root.stageOutput('RouteTransientSolver').value[0].probes.map(probe => probe.name), ['DATA_0', 'VICTIM_0', 'VICTIM_1'])
  const pending = solver(response())
  assert.equal(pending.visualize().lines!.filter(line => line.label).length, 0, 'no curves before ngspice returns')
  const failed = solver(response(undefined, undefined, 'fatal: rejected'))
  await assert.rejects(failed.solveAsync(), /fatal/)
  assert.ok(failed.visualize().polygons!.some(edge => edge.stroke === routeTones.failure), 'the plot pane is outlined red')
})
