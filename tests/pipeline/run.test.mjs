import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline } from '../../src/index.ts'

test('removed modeling input fails before any solver invocation', async () => {
  let calls = 0
  await assert.rejects(runPipeline({ circuitJson: [], ibisSources: {}, modeling: {}, runSolver: async () => {
    calls++
    throw Error('unreachable')
  } }), { code: 'signal_integrity_input', message: /modeling has been removed/ })
  assert.equal(calls, 0)
})

test('no SI blocks return an empty result', async () => {
  const result = await runPipeline({ circuitJson: [], ibisSources: {}, runSolver: async () => {
    throw Error('unreachable')
  } })
  assert.deepEqual(result.blocks, [])
})
