import test from 'node:test'
import assert from 'node:assert/strict'
import { rootScope } from '../../src/kernel'
import { extractChannel } from '../../src/extraction'
import { barFixture, consistentSolver } from './solvers'

test('extraction remains deterministic and records the matrices and native request evidence', async () => {
  const { geometry, modeling } = barFixture()
  const first = await extractChannel(geometry, modeling, rootScope('extraction'), { runSolver: consistentSolver(geometry, modeling), progress: () => {} })
  const second = await extractChannel(geometry, modeling, rootScope('extraction'), { runSolver: consistentSolver(geometry, modeling), progress: () => {} })
  assert.deepEqual(first, second)
  assert.ok(first.artifacts.some(a => a.path.endsWith('extraction.json')))
  assert.ok(first.artifacts.some(a => a.path.endsWith('fasthenry.request.json')))
})
