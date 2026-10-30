import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup, reachedCap } from './fixtures/fasthenry-retry.js'

test('successful segment solves never retry', async () => {
  const good=setup()
  await assert.rejects(extractChannel(geometry,modeling,good.files,good.solve,()=>{},{fastHenryConvergenceRetry:'cube'}),error=>error===reachedCap)
  assert.deepEqual(good.calls.map(c=>c.solver==='fasthenry'?c.args[1]:c.solver),['seg','seg','fastercap'])
  assert.equal(Object.keys(good.files).some(k=>k.includes('retry')),false)
})
