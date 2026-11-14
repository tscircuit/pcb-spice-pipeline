import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteTransientSolver, type RoutedDeck } from '../../src/simulation'
import { routedRequest } from '../../src/simulation/route-transient'
import { formatSpiceVectors } from '../../src/observation'
import type { SolverResult } from '../../src/solver'

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
  ['truncated', response([0, 5e-10], [0, 1]), /simulation_duration: .*did not complete/],
  ['beginning', response([5e-10, 1e-9], [0, 1]), /simulation_start: .*omits the beginning/],
  ['fatal', response(undefined, undefined, 'fatal: rejected'), /native_solver: .*fatal/],
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

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'
import { routeTones } from '../../src/board'

test('live stage uses the shared waveform atlas for completed samples and failure diagnostics', async () => {
  const { root } = await routedVisualFixture()
  const stage = root.getSolver<RouteTransientSolver>('RouteTransientSolver')!
  assertRouteVisual(stage.visualize(), 'simulation', 'route-transient')
  const curves = stage.visualize().lines!.filter(line => line.layer === 'waveform')
  assert.deepEqual(curves.map(line => [line.label, Boolean(line.strokeDash)]), [['VICTIM', true], ['DATA', false], ['VICTIM', false]], 'near-end probes are dashed and drawn underneath')
  assert.equal(new Set(curves.map(line => line.strokeColor)).size, 2, 'curves take their net colour')
  assert.ok(stage.visualize().texts!.every(text => / (V|ns)$/.test(text.text)), 'only axis ticks are written')
  assert.deepEqual(root.stageOutput('RouteTransientSolver').value[0].probes.map(probe => probe.name), ['DATA_0', 'VICTIM_0', 'VICTIM_1'])
  const pending = solver(response())
  assert.equal(pending.visualize().lines!.filter(line => line.layer === 'waveform').length, 0, 'no curves before ngspice returns')
  const failed = solver(response(undefined, undefined, 'fatal: rejected'))
  await assert.rejects(failed.solveAsync(), /fatal/)
  assert.ok(failed.visualize().polygons!.some(edge => edge.stroke === routeTones.failure), 'the plot pane is outlined red')
})
