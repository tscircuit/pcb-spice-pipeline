import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup } from './fixtures/fasthenry-retry.js'

test('a failed cube retry is rejected', async () => {
  const fail=setup({phase:'coarse',retryFails:true})
  await assert.rejects(extractChannel(geometry,modeling,fail.files,fail.solve,()=>{},{fastHenryConvergenceRetry:'cube'}),/native_convergence/)
  assert.deepEqual(fail.calls.map(c=>c.args[1]),['seg','cube'])
})
