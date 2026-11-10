import test from 'node:test'
import assert from 'node:assert/strict'
import { causalLossPoles, causalLossResponse } from '../../src/extraction'

test('positive-real loss quadrature is bounded over the DDR edge band', () => {
  assert.ok(causalLossPoles().every(pole => pole.rate > 0 && pole.skin > 0 && pole.dielectric > 0))
  for (let i = 0; i <= 100; i++) {
    const frequency = 1e7 * 500 ** (i / 100)
    const response = causalLossResponse(frequency)
    assert.ok(Math.abs(response.skinReal / Math.sqrt(frequency) - 1) < .05)
    assert.ok(Math.abs(response.dielectricReal / (2 * Math.PI * frequency) - 1) < .06)
    assert.ok(response.skinImaginary > 0 && response.dielectricCapacitance > 0)
  }
})
