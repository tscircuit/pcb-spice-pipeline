import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCrossSection, type CrossSection } from '../../src/extraction'

// The parallel-plate limit independently tests material energy weighting and both reference/signal loss.
test('layered/mask energy sensitivity and Wheeler loss approach the analytic parallel-plate limits', () => {
  const section: CrossSection = {
    conductors: [{ id: 's', xMm: 0, zMm: .2, widthMm: 100, thicknessMm: .035 }],
    planes: [{ zMm: 0 }],
    dielectrics: [
      { zMm: 0, thicknessMm: .18, er: 4.1, lossTangent: .02 },
      { zMm: .18, thicknessMm: .02, er: 3.3, lossTangent: .025 },
    ],
  }
  const result = solveCrossSection(section)
  const electrical = .18 / 4.1 + .02 / 3.3
  const expectedC = 8.8541878128e-12 * 100 / electrical
  const expectedLoss = expectedC * (.18 / 4.1 * .02 + .02 / 3.3 * .025) / electrical
  const rs = Math.sqrt(Math.PI * 1.25663706212e-6 / 5.8e7)
  const expectedSkin = rs * (2 / .1 + 2 * .0002 / .1 ** 2)
  assert.ok(Math.abs(result.C[0][0] / expectedC - 1) < .01)
  assert.ok(Math.abs(result.dielectricLoss[0][0] / expectedLoss - 1) < .01)
  assert.ok(Math.abs(result.skinResistance[0][0] / expectedSkin - 1) < .02)
  assert.ok(Math.abs(result.dcResistance[0][0] * (5.8e7 * .1 * .000035) - 1) < 1e-14)
  const low = result.atFrequency(1)
  const high = result.atFrequency(1e12)
  assert.ok(Math.abs(low.R[0][0] / result.dcResistance[0][0] - 1) < 1e-6)
  assert.ok(Math.abs(high.R[0][0] / (1e6 * result.skinResistance[0][0]) - 1) < 1e-5)
  // Finite difference is an independent oracle for the analytic directional sensitivity.
  const step = .001
  const plus = solveCrossSection({ ...section, dielectrics: section.dielectrics.map(d => ({ ...d, er: d.er * (1 + step * d.lossTangent) })) })
  const minus = solveCrossSection({ ...section, dielectrics: section.dielectrics.map(d => ({ ...d, er: d.er * (1 - step * d.lossTangent) })) })
  assert.ok(Math.abs((plus.C[0][0] - minus.C[0][0]) / (2 * step) / result.dielectricLoss[0][0] - 1) < 1e-6)
  const lowerConductivity = solveCrossSection({ ...section, conductors: section.conductors.map(c => ({ ...c, conductivitySm: 5.8e7 / 4 })), planes: section.planes.map(p => ({ ...p, conductivitySm: 5.8e7 / 4 })) })
  assert.ok(Math.abs(lowerConductivity.skinResistance[0][0] / result.skinResistance[0][0] - 2) < 1e-8)
  assert.ok(Math.abs(lowerConductivity.dcResistance[0][0] / result.dcResistance[0][0] - 4) < 1e-12)
  const half = solveCrossSection(section, { recessionFraction: .005 })
  assert.ok(Math.abs(half.skinResistance[0][0] / result.skinResistance[0][0] - 1) < .001)
  // Equal er but different tangents must retain a loss-only dielectric interface.
  const equal = solveCrossSection({ ...section, dielectrics: section.dielectrics.map(d => ({ ...d, er: 4 })) })
  const expectedEqual = equal.C[0][0] * (.18 * .02 + .02 * .025) / .2
  assert.ok(Math.abs(equal.dielectricLoss[0][0] / expectedEqual - 1) < .005)
})
