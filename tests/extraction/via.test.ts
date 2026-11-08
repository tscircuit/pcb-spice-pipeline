import test from 'node:test'
import assert from 'node:assert/strict'
import { viaRlc } from '../../src/extraction'
test('TI Pocket Reference worked via example gives approximately 1.2 nH and .46 pF', () => {
  const v = viaRlc({ lengthMm: 1.6, holeMm: .4, padMm: .8, antipadMm: 1.5, er: 4.5, platingMm: .025, conductivitySm: 5.8e7 })
  assert.ok(Math.abs(v.L / 1.2e-9 - 1) < .02)
  assert.ok(Math.abs(v.C / .46e-12 - 1) < .02)
  assert.ok(v.R > 0)
})
