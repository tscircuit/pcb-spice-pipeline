import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleVoltage, crossingTimes, quietPeak, measureEye, strobeMargins } from '../../src/observation'

test('adaptive interpolation and both received strobe polarities', () => {
  const rows = [[0, -1], [1, 1], [3, -1]]
  assert.equal(sampleVoltage(rows, 1, .25), -.5)
  assert.deepEqual(crossingTimes(rows, 1, 0, 0), [.5, 2])
  assert.throws(() => sampleVoltage(rows, 1, -1), /outside/)
})

test('quiet-high noise removes its DC baseline instead of reporting the 3.3 V rail', () => {
  assert.ok(Math.abs(quietPeak([[0, 3.3], [1, 3.31], [2, 3.3]], 1, 0) - .005) < 1e-12)
  assert.ok(quietPeak([[0, 0], [1, .01], [2, 0]], 1, 0) < .011)
})

test('finite known-bit eye measures inner voltage envelopes and threshold-qualified width', () => {
  const rows = Array.from({ length: 1001 }, (_, i) => {
    const t = i / 100
    const phase = t % 2
    const value = phase < .1 ? 3.3 * (1 - phase / .1) : phase < 1 ? 0 : phase < 1.1 ? 3.3 * (phase - 1) / .1 : 3.3
    return [t, value]
  })
  const eye = measureEye(rows, 1, '01', 1, 0, 2, 2, .8)
  assert.ok(eye.height > 3.2)
  assert.ok(eye.width > .8 && eye.width <= 1)
  assert.ok(eye.margin > .7)
  assert.equal(eye.traces[0].length, 401)
})

test('setup/hold uses interpolated threshold crossings, and invalid captures fail margins', () => {
  const rows = [[0, 0], [1, 0], [2, 3.3], [3, 3.3], [4, 0], [5, 0]]
  const [edge] = strobeMargins(rows, 1, [2.5], 2, .8, .1, .2)
  assert.ok(Math.abs(edge.setup_margin_s - (2.5 - (1 + 2 / 3.3) - .1)) < 1e-12)
  assert.ok(edge.hold_margin_s > .6)
  const [invalid] = strobeMargins(rows, 1, [1.5], 2, .8, .1, .2)
  assert.deepEqual([invalid.setup_margin_s, invalid.hold_margin_s], [-.1, -.2])
})
