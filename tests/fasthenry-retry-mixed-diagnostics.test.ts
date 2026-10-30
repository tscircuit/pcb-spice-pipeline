import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup } from './fixtures/fasthenry-retry.js'

test('other solver diagnostics prevent a convergence retry', async () => {
  const mixed=setup({phase:'coarse',extra:'Internal error in dist_betw_fils: D1D1 too small!'})
  await assert.rejects(extractChannel(geometry,modeling,mixed.files,mixed.solve,()=>{},{fastHenryConvergenceRetry:'cube'}))
  assert.equal(mixed.calls.length,1)
})
