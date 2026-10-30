import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup } from './fixtures/fasthenry-retry.js'

test('exit solver failure does not retry', async () => {
  const failure = 'exit'
  const example=setup({failure})
  await assert.rejects(extractChannel(geometry,modeling,example.files,example.solve,()=>{},{fastHenryConvergenceRetry:'cube'}))
  assert.equal(example.calls.length,1)
})
