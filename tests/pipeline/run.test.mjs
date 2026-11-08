import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline } from '../../src/index.ts'

test('removed modeling input fails before any solver invocation', async () => {
  let calls = 0
  await assert.rejects(runPipeline({ circuitJson: [], ibisSources: {}, modeling: {}, runSolver: async () => { calls++; throw Error('unreachable') } }), /modeling has been removed/)
  assert.equal(calls, 0)
})

test('old experiments without signal-integrity source records cannot run', async () => {
  await assert.rejects(runPipeline({ circuitJson: [], ibisSources: {}, runSolver: async () => { throw Error('unreachable') } }), /requires simulation_signal_integrity/)
})
