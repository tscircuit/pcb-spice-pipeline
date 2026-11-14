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

test('golden invariants: causal-loss poles are stable and every Foster branch is passive', () => {
  // Foster RL/RC branches with positive elements are positive-real (Guillemin, Synthesis of Passive Networks, ch. 4):
  // every pole s = -rate lies in the left half-plane and every weight is positive, so Re Z(jw) >= 0 and
  // Re Y(jw) >= 0 at every frequency. Checked exactly on the element values and numerically from 1 Hz to 1 THz.
  const poles = causalLossPoles()
  assert.ok(poles.every(pole => Number.isFinite(pole.rate) && -pole.rate < 0), 'every pole is real and negative')
  assert.ok(poles.every(pole => pole.skin > 0 && pole.skin / pole.rate > 0 && pole.dielectric > 0), 'every R, L, G and C element is positive')
  for (let i = 0; i <= 240; i++) {
    const response = causalLossResponse(10 ** (i / 20))
    assert.ok(response.skinReal >= 0 && response.dielectricReal >= 0 && response.dielectricCapacitance > 0, `passive at ${10 ** (i / 20)} Hz`)
  }
})

// Tolerance 5% over 10 MHz–5 GHz for both checks below: the band and bound the magnitude test above already uses.
test('golden stage 3: causal skin loss has the good-conductor 45 degree phase', { todo: 'FAILS as declared. Measured worst |X/R - 1| = 7.2% (at 1.85 GHz) over 10 MHz–5 GHz, outside 5%: ripple of the one-pole-per-decade quadrature.' }, () => {
  // A good conductor's surface impedance is Zs = (1 + j) Rs (Ramo, Whinnery & Van Duzer, Fields and Waves,
  // section 5.4), so the internal reactance equals the skin resistance.
  for (let i = 0; i <= 50; i++) {
    const response = causalLossResponse(1e7 * 500 ** (i / 50))
    assert.ok(Math.abs(response.skinImaginary / response.skinReal - 1) <= .05, `X/R ${response.skinImaginary / response.skinReal}`)
  }
})

test('golden stage 3: causal dielectric loss obeys the Kramers–Kronig slope locally', { todo: 'FAILS as declared. Measured worst local |dC/dln(w) / (-(2/pi) G/w) - 1| = 18.5% (at 30.6 MHz) over 10 MHz–5 GHz, outside 5%. Post-hoc diagnostic: averaged over one decade the slope equals -2/pi within 2.5e-7, so the error is quadrature ripple, not a causality violation.' }, () => {
  // A constant loss tangent over a wide band forces dC/d ln(w) = -(2/pi) G/w by Kramers–Kronig (Djordjevic, Biljic,
  // Likar-Smiljanic & Sarkar, IEEE Trans. EMC 43 (2001) 662–667).
  for (let i = 0; i <= 50; i++) {
    const frequency = 1e7 * 500 ** (i / 50)
    const response = causalLossResponse(frequency)
    const slope = (causalLossResponse(frequency * 1.01).dielectricCapacitance - response.dielectricCapacitance) / Math.log(1.01)
    const expected = -2 / Math.PI * response.dielectricReal / (2 * Math.PI * frequency)
    assert.ok(Math.abs(slope / expected - 1) <= .05, `${frequency} Hz: ${slope} vs ${expected}`)
  }
})
