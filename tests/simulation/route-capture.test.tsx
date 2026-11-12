import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteCaptureSolver, executeRoutedDeck, type RoutedDeck, type RoutedExecution } from '../../src/simulation'
import { rootScope } from '../../src/kernel'
import { createNativeSolver } from '../../src/adapters'
import { RoutedAdmissionSolver, RoutedBlockSolver } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'

// Synthetic protocol/parser fixtures only; the separate native test uses the real TSX deck.
const compiled: RoutedDeck = { blockId: 'test', name: 'test', deck: 'test', requestSha256: 'test-request', durationSeconds: 1e-9, stepSeconds: 1e-11, evidence: {}, probes: [{ name: 'VICTIM', column: 1, simulationVoltageProbeId: 'p', signalSourceId: 'port', referenceSourceId: null, signalNode: 'n1', referenceNode: '0' }] }
/** Synthetic accepted port response, never native evidence. */
function execution(text: string, stdout: string = ''): RoutedExecution {
  return { requestSha256: compiled.requestSha256, run: { stdout, stderr: '', outputs: { 'waveform.dat': text }, files: {}, logPaths: [] } }
}

test('capture without execution explicitly shows native not run and contains no waveform', () => {
  const solver = new RouteCaptureSolver({ compiled, artifactPrefix: 'test' })
  solver.solve()
  assert.deepEqual(solver.getOutput(), { value: { kind: 'not-run' }, artifacts: [] })
  assert.equal(solver.visualize().lines!.length, 0)
  assert.match(solver.visualize().texts![0].text, /native not run/)
})

test('synthetic parser retains actual adaptive times and labels candidate samples', () => {
  const solver = new RouteCaptureSolver({ compiled, execution: execution('time p\n0 0\n2e-10 .3\n1e-9 .1'), artifactPrefix: 'test' })
  solver.solve()
  const capture = solver.getOutput().value
  assert.equal(capture.kind, 'completed')
  if (capture.kind !== 'completed') return
  assert.deepEqual(capture.timestampsSeconds, [0, 2e-10, 1e-9])
  assert.deepEqual(capture.probes[0].voltageLevels, [0, .3, .1])
  assert.equal(capture.qualification, 'candidate-unqualified')
  assert.ok(solver.visualize().lines!.some(line => line.strokeColor === '#9333ea'))
  assert.ok(solver.visualize().lines!.some(line => line.label === '1.9 V'))
})

for (const [label, text, diagnostic, pattern] of [
  ['truncated', 'time p\n0 0\n5e-10 0', '', /native solver did not complete/],
  ['nonfinite', 'time p\n0 0\n1e-9 NaN', '', /finite column/],
  ['beginning', 'time p\n5e-10 0\n1e-9 0', '', /omits the beginning/],
  ['fatal', 'time p\n0 0\n1e-9 0', 'fatal: rejected', /fatal/],
] as const) test(`synthetic capture rejects ${label} output without partial success`, () => {
  const solver = new RouteCaptureSolver({ compiled, execution: execution(text, diagnostic), artifactPrefix: 'test' })
  assert.throws(() => solver.solve(), pattern)
  assert.equal(solver.failed, true)
  assert.throws(() => solver.getOutput(), /incomplete/)
})

test('async native shell serializes concurrent callers through invoke, including a rejected request', async () => {
  let active = 0
  let maximum = 0
  const ctx = { progress: (): void => undefined, runSolver: async (): Promise<{ stdout: string; stderr: string; files: Record<string, string> }> => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise<void>(resolve => setImmediate(resolve))
    active--
    return { stdout: '', stderr: '', files: { 'waveform.dat': 'time p\n0 0\n1e-9 0' } }
  } }
  const outputs = await Promise.all([executeRoutedDeck(ctx, compiled, rootScope('simulation').child('first')), executeRoutedDeck(ctx, compiled, rootScope('simulation').child('second'))])
  assert.equal(maximum, 1)
  assert.ok(outputs.every(output => output.artifacts.some(artifact => artifact.owner === 'solver' && artifact.path.endsWith('ngspice.request.json'))))
  await assert.rejects(executeRoutedDeck({ ...ctx, runSolver: async () => {
    throw new Error('unavailable')
  } }, compiled, rootScope('simulation').child('failure')), /unavailable/)
  await assert.doesNotReject(executeRoutedDeck(ctx, compiled, rootScope('simulation').child('after-failure')))
})

test('bounded native ngspice executes the real two-trace TSX deck and capture parses both probes', { skip: process.env.SI_NATIVE_TESTS !== '1' && 'Set SI_NATIVE_TESTS=1 and IBIS_MODEL_DIR for the serial 10-second native test' }, async context => {
  const input = await routedProblem(context)
  if (!input) return
  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  const plan = structuredClone(admission.getOutput().value[0])
  plan.bindings.options = { riseSeconds: 1e-9, refinement: 1, stepSeconds: 1e-11, durationSeconds: 4e-9 }
  const compiler = new RoutedBlockSolver(plan)
  compiler.solve()
  const compiled = compiler.getOutput().value.compiled
  const output = await executeRoutedDeck({ runSolver: createNativeSolver({ timeoutMs: 10_000 }), progress: (): void => undefined }, compiled, rootScope('simulation').child('native'))
  const capture = new RouteCaptureSolver({ compiled, execution: output.value, artifactPrefix: 'native' })
  capture.solve()
  const result = capture.getOutput().value
  assert.equal(result.kind, 'completed')
  if (result.kind !== 'completed') return
  assert.equal(result.probes.length, compiled.probes.length)
  assert.ok(result.timestampsSeconds.length > 20)
  assert.equal(result.timestampsSeconds.at(-1), 4e-9)
  assert.ok(result.probes.every(probe => probe.voltageLevels.every(Number.isFinite)))
})
