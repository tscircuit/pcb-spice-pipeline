import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleVoltage } from '../../src/observation'

test('adaptive interpolation includes the recording bounds and rejects extrapolation', () => {
  const rows = [[0, -1], [1, 1], [3, -1]]
  assert.equal(sampleVoltage(rows, 1, .25), -.5)
  assert.equal(sampleVoltage(rows, 1, 3), -1)
  assert.throws(() => sampleVoltage(rows, 1, -1), /outside/)
})
