import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteTransientSolver, type RoutedDeck, routedControl } from '../../src/simulation'
import { routedRequest } from '../../src/simulation/route-transient'
import { formatSpiceVectors, probeWaveformRows, sampleVoltage } from '../../src/observation'
import { createNativeSolver } from '../../src/adapters'
import { runSpiceEngine } from '../../src/adapters/browser/spice-engine'
import { RoutedAdmissionSolver, RoutedBlockSolver } from '../../src/pipeline'
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

test('real TSX two-trace: old/native deck parity and sequential native/WASM engine parity', { skip: process.env.SI_NATIVE_TESTS !== '1' && 'Set SI_NATIVE_TESTS=1 and IBIS_MODEL_DIR for bounded sequential native/WASM checks' }, async context => {
  const input = await routedProblem(context, { 'bit-rate': '50Mbps', 'duration-seconds': 40e-9 })
  if (!input) return
  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  const plan = structuredClone(admission.getOutput().value[0])
  plan.bindings.options = { riseSeconds: 1e-9, refinement: 1, stepSeconds: 1e-11, durationSeconds: 40e-9 }
  const port: SolverContext = { runSolver: createNativeSolver({ timeoutMs: 10_000 }), progress: (): void => undefined }
  const compiler = new RoutedBlockSolver({ ...plan, context: port })
  compiler.solveUntilStage('RouteTransientSolver')
  const deck = compiler.getStageOutput<{ value: RoutedDeck }>('RouteNetworkSolver')!.value
  const originalStart = performance.now()
  const original = await port.runSolver({ solver: 'ngspice', files: { 'simulation.cir': oldControl(deck) }, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
  const originalMs = performance.now() - originalStart
  const oldRows = probeWaveformRows(original.files['waveform.dat'], deck.probes)
  const nativeStart = performance.now()
  await compiler.solveAsync()
  const nativeMs = performance.now() - nativeStart
  const native = compiler.getOutput().value.capture
  const nativeRows = native.timestampsSeconds.map((time, i) => [time, ...native.probes.map(probe => probe.voltageLevels[i])])
  const wasmStart = performance.now()
  const wasm = new RouteTransientSolver({ compiled: deck, artifactPrefix: 'wasm', context: { ...port, runSolver: request => runSpiceEngine(request.files['simulation.cir']) } })
  await wasm.solveAsync()
  const wasmMs = performance.now() - wasmStart
  const capture = wasm.getOutput().value
  const wasmRows = capture.timestampsSeconds.map((time, i) => [time, ...capture.probes.map(probe => probe.voltageLevels[i])])
  const oldNativeMaxV = maximumDifference(oldRows, nativeRows)
  const nativeWasmMaxV = maximumDifference(nativeRows, wasmRows)
  assert.ok(oldNativeMaxV <= .001, `old/new native max difference ${oldNativeMaxV} V`)
  assert.ok(nativeWasmMaxV <= .0012, `native/WASM max difference ${nativeWasmMaxV} V`)
  assert.equal(capture.probes.length, deck.probes.length)
  assert.equal(capture.timestampsSeconds.at(-1), 40e-9)
  assert.ok(capture.timestampsSeconds.length > 20)
  const signal = capture.probes[0].voltageLevels
  assert.ok(Math.max(...signal) - Math.min(...signal) > .5, 'comparison must exercise a real switching edge')
  context.diagnostic(JSON.stringify({ durationSeconds: 40e-9, bitRateHz: 50e6, signalSwingV: Math.max(...signal) - Math.min(...signal), originalMs, nativeMs, wasmMs, oldNativeMaxV, nativeWasmMaxV, nativeSamples: nativeRows.length, wasmSamples: wasmRows.length }))
})


import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('live stage uses the shared waveform atlas for completed samples and failure diagnostics', async () => {
  const { block } = await routedVisualFixture()
  const stage = block.getSolver<RouteTransientSolver>('RouteTransientSolver')!
  assertRouteVisual(stage.visualize(), 'simulation', 'route-transient')
  assert.ok(stage.visualize().lines!.some(line => line.strokeColor === '#9333ea'))
  assert.ok(stage.visualize().texts!.some(text => text.text.includes('ngspice samples')))
  const pending = solver(response())
  assert.ok(pending.visualize().texts!.some(text => text.text.includes('awaiting live ngspice')))
  assert.equal(pending.visualize().lines!.filter(line => line.strokeWidth === .3).length, 0)
  const failed = solver(response(undefined, undefined, 'fatal: rejected'))
  await assert.rejects(failed.solveAsync(), /fatal/)
  assert.ok(failed.visualize().texts!.some(text => text.color === '#dc2626' && text.text.includes('fatal')))
})
