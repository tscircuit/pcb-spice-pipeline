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

test('review 9: tiny nonzero loss samples retain the same maximum relative-error contract', () => {
  const frequencies = Array.from({length:81}, (_, i) => 10 ** (12 * i / 80))
  const target = frequencies.map(f => f * f / (f * f + 1e6))
  const fit = fitLoss(frequencies, target)
  const maximum = Math.max(...target.map((v, i) => Math.abs(fittedLoss(fit, frequencies[i]) / v - 1)))
  assert.ok(maximum <= .02, `actual maximum relative error ${maximum}; reported ${fit.maxRelative}`)
})


test('review 9: a continuous-pole certificate rejects nonconcave loss without a branch cap', () => {
  assert.throws(() => fitLoss([1, 2, 4], [1, 1.01, 4]), error => error instanceof Error && /loss_fit: Continuous-pole dual certificate/.test(error.message))
})

test('review 8: finite slab remains accurate from DC through the skin regime without a shared transition', async () => {
  const { slabExcess } = await import('../../src/extraction')
  const t = 35e-6
  const sigma = 5.8e7
  const f0 = 1 / (Math.PI * 1.25663706212e-6 * sigma * t * t)
  for (const x of [.001, .1, 1, 10, 100]) {
    const actual = 1 + slabExcess(f0 * x * x, t, sigma) * Math.sqrt(sigma) * t
    const expected = x > 20 ? x : x * (Math.sinh(2*x) + Math.sin(2*x)) / (Math.cosh(2*x) - Math.cos(2*x))
    assert.ok(Math.abs(actual / expected - 1) < .02)
  }
  assert.equal(slabExcess(0, t, sigma), 0)
  assert.throws(() => slabExcess(1, 0, sigma), { code: 'loss_fit' })
})

test('review 8: actual TSX opposing strips reproduce the published one-face proximity loss within 2%', async () => {
  const { slabBoard } = await import('../fixtures/slab')
  const { geometryFromCircuitJson } = await import('../../src/board')
  const { solveCrossSection, slabExcess } = await import('../../src/extraction')
  const { circuitJson, modeling } = await slabBoard()
  const slice = geometryFromCircuitJson(circuitJson, modeling).cells.find(c => c.start[0] <= 0 && c.end[0] > 0)!.slice!
  const result = solveCrossSection(slice)
  const sigma = 5.8e7
  const t = 35e-6
  const width = .02
  const f = 100 / (Math.PI * 1.25663706212e-6 * sigma * t * t)
  // NBS J. Res. 84 (1979), 247, eq. 3.3: two wide strips, current on facing surfaces, Z'=2*Zs/w+j*omega*mu0*s/w.
  // At t/delta=10, Re[(1+j)*10*coth((1+j)*10)] = 10 to the precision needed here.
  const expected = 2 * 10 / (sigma * t * width)
  const actual = 2 / (sigma * t * width) + result.surfaces!.reduce((sum, face) => sum + face.matrix[0][0] * slabExcess(f, face.thicknessM, face.conductivitySm), 0)
  assert.ok(Math.abs(actual / expected - 1) < .02, `${actual} vs ${expected}`)
  assert.ok(result.steps.at(-1)!.residual! < .005)
})
