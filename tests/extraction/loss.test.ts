import test from 'node:test'
import assert from 'node:assert/strict'
import { fitLoss, fittedLoss } from '../../src/extraction'
test('nonnegative Foster fit reproduces a known positive-real branch spectrum', () => {
  const f = Array.from({length:41}, (_,i) => 1e6 * 100 ** (i/40))
  const target = f.map(v => v*v/(v*v+1e12))
  const fit = fitLoss(f,target)
  assert.ok(fit.weights.every(w=>w>=0))
  assert.ok(fit.relativeRms < .08)
  assert.equal(fittedLoss(fit,0),0)
})
