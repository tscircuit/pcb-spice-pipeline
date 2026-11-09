import test from 'node:test'
import assert from 'node:assert/strict'
import { fitLoss, fittedLoss, fittedStorage } from '../../src/extraction'
test('nonnegative Foster fit reproduces a known positive-real branch spectrum', () => {
  const f = Array.from({length:41}, (_,i) => 1e6 * 100 ** (i/40))
  const target = f.map(v => v*v/(v*v+1e12))
  const fit = fitLoss(f,target)
  assert.ok(fit.weights.every(w=>w>=0))
  assert.ok(fit.relativeRms < .08)
  assert.equal(fittedLoss(fit,0),0)
})

test('invalid and zero loss data terminate explicitly, with no hidden fit loop', () => {
  assert.throws(() => fitLoss([NaN],[1]),{code:'loss_fit'})
  assert.deepEqual(fitLoss([1,10],[0,0]).weights,[])
})

test('Foster tabulation retains the reactive storage of the exact same causal branch',()=>{
  const fit={poles:[3],weights:[7],relativeRms:0,maxRelative:0}
  const f=2/(2*Math.PI)
  assert.equal(fittedLoss(fit,f),28/13)
  assert.equal(fittedStorage(fit,f),21/13)
  assert.equal(fittedStorage(fit,0),7/3)
})

test('review 9: loss accuracy is contractual across the excitation band, with adaptive branch count', () => {
  const frequencies = Array.from({length:161}, (_, i) => 2e6 * 500 ** (i / 160))
  for (const target of [frequencies.map(f => Math.sqrt(f)), frequencies.map(f => 2 * Math.PI * f)]) {
    const fit = fitLoss(frequencies, target)
    assert.ok(fit.maxRelative <= .02, `maximum relative error ${fit.maxRelative}`)
    assert.ok(fit.weights.every(w => Number.isFinite(w) && w >= 0))
  }
})
test('review 9: a non-Foster loss target fails explicitly instead of returning a bad fit', () => {
  assert.throws(() => fitLoss([1,2,4], [1,10,100]), {code:'loss_fit'})
})
