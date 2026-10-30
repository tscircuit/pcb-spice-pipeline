import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup } from './fixtures/fasthenry-retry.js'

test('a converged cube solve cannot bypass mesh refinement checks', async () => {
  const example=setup({phase:'refinement',retryBadMesh:true})
  await assert.rejects(extractChannel(geometry,modeling,example.files,example.solve,()=>{},{fastHenryConvergenceRetry:'cube'}),/mesh_convergence/)
  assert.deepEqual(example.calls.map(c=>c.args[1]),['seg','seg','cube'])
})
