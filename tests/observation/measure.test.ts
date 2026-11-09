import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleVoltage, crossingTimes, quietPeak, measureEye, strobeMargins } from '../../src/observation'

/** Numeric agreement without requiring identical floating point evaluation order. */
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('adaptive interpolation and both received strobe polarities', () => {
  const rows = [[0, -1], [1, 1], [3, -1]]
  assert.equal(sampleVoltage(rows, 1, .25), -.5)
  assert.deepEqual(crossingTimes(rows, 1, 0, 0), [.5, 2])
  assert.throws(() => sampleVoltage(rows, 1, -1), /outside/)
})

test('quiet-high and quiet-low peaks retain the full signed excursion from idle', () => {
  close(quietPeak([[0, 3.3], [1, 3.31], [2, 3.3]], 1, 0, 3.3).peak_positive_v, .01)
  assert.deepEqual(quietPeak([[0, 0], [1, .01], [2, -.02]], 1, 0, 0), { idle_voltage_v: 0, peak_positive_v: .01, peak_negative_v: -.02 })
})

test('eye sampling is fixed at 0.5 UI; an opening elsewhere cannot improve the result', () => {
  const rows = [[0, 0], [.5, .7], [.9, 0], [1, 0], [1.5, .8], [1.9, 1], [2, 0], [2.5, 0], [3, 1], [4, 0]]
  const eye = measureEye(rows, 1, '01', 1, 0, 0, .9, .6)
  close(eye.height, .1)
  close(eye.margin, -.1)
  assert.equal(eye.width, 0)
  assert.equal(eye.traces[0].timestamps_s[0], 0)
  assert.equal(eye.traces[0].timestamps_s.at(-1), 2)
})

test('RFC strobe vectors use expected-bit intervals including invalid captures and zero requirements', () => {
  const vectors = [
    { interval: [.5, 1.5], s: .010, h: .045, expected: [.490, .455] },
    { interval: [1.02, 2.08], s: .010, h: .045, expected: [-.030, 1.035] },
    { interval: [.2, .98], s: .010, h: .045, expected: [.790, -.065] },
    { interval: undefined, s: .010, h: .045, expected: [-3.010, -3.045] },
    { interval: [1.02, 2.08], s: 0, h: 0, expected: [-.020, 1.080] },
  ]
  for (const vector of vectors) {
    const interval = vector.interval
    const rows = interval ? [[0, .1], [interval[0] - .01, .8], [interval[0], .9], [interval[0] + .01, 1], [interval[1] - .01, 1], [interval[1], .9], [interval[1] + .01, .8], [3, .1]] : [[0, .1], [3, .1]]
    const [edge] = strobeMargins(rows, 1, [{ time: 1, high: true }], .9, .6, vector.s, vector.h)
    close(edge.setup_margin_s, vector.expected[0])
    close(edge.hold_margin_s, vector.expected[1])
  }
})
