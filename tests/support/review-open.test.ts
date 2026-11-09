import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson } from '../../src/board'
import { extractChannel, fittedLoss } from '../../src/extraction'
import { rootScope } from '../../src/kernel'
import { reviewBoard } from '../fixtures/review-geometry'

// These red regressions remain visible until the physical/numerical methods meet the contract.
test('review 8: skin transition agrees with the one-face finite slab at delta = thickness', { todo: 'Finite-thickness surface impedance is not implemented; see REPORT.md finding 8' }, async () => {
  const { circuitJson, modeling } = await reviewBoard()
  const geometry = geometryFromCircuitJson(circuitJson, modeling)
  const copper = geometry.stackup.copperLayers[0]
  const thickness = (copper.zMaxMm - copper.zMinMm) / 1000
  const sigma = copper.conductivitySm
  const mu0 = 1.25663706212e-6
  const frequency = 1 / (Math.PI * mu0 * sigma * thickness ** 2)
  const channel = (await extractChannel(geometry, { bitRateHz: frequency, riseTimeSeconds: 5 / (10 * frequency) }, rootScope('extraction'), { progress: () => {}, runSolver: async () => {
    throw Error('No native extraction allowed')
  } })).value
  const actual = 1 + fittedLoss(channel.matrices[0].skin.fit, frequency) / Math.sqrt(Math.PI * mu0 * frequency)
  // Re[(1+j)coth(1+j)], independently evaluated with real sinh/cos functions.
  const expected = (Math.sinh(2) + Math.sin(2)) / (Math.cosh(2) - Math.cos(2))
  assert.ok(Math.abs(actual / expected - 1) < .02, `${actual} vs ${expected}`)
})

test('review 10: identical original RS-485 copper can be extracted for a qualified mutual-L comparison', { todo: 'Original geometry cannot yet be extracted soundly; see REPORT.md finding 10' }, async () => {
  const { makeGapBoard } = await import('../fixtures/rs485-gap')
  const circuitJson = await makeGapBoard()
  geometryFromCircuitJson(circuitJson, { lanes: ['A', 'B'].map(port => ({ port, from: { component: 'TX', port }, to: { component: 'RX', port } })) })
})

test('review 11: cold extraction of the original crosstalk TSX completes in seconds', { todo: 'Whole-board cold speed is unqualified; see REPORT.md finding 11' }, async () => {
  const { circuitJson, modeling } = await import('../../examples/crosstalk/index.circuit')
  const started = performance.now()
  const geometry = geometryFromCircuitJson(circuitJson, modeling)
  await extractChannel(geometry, { bitRateHz: 20e6, riseTimeSeconds: 1e-9 }, rootScope('extraction'), { progress: () => {}, runSolver: async () => {
    throw Error('No native extraction allowed')
  } })
  assert.ok((performance.now() - started) / 1000 < 60)
})
