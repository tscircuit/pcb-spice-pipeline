import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup } from './fixtures/fasthenry-retry.js'

test('retry is disabled by default', async () => {
  const first=setup({phase:'coarse'})
  await assert.rejects(extractChannel(geometry,modeling,first.files,first.solve),/native_convergence/)
  assert.equal(first.calls.length,1)
})
