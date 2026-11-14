import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCrossSection, type CrossSection } from '../../src/extraction'
import { coupledMicrostrip, singleMicrostrip, imageMicrostrip, thickMicrostrip } from './cross-section-reference'

/** Normalized microstrip family; includes very thin, nearly coincident top/bottom panels. */
function fixture(width: number, gap: number, er: number, count: number, thickness: number): CrossSection {
  return {
    conductors: Array.from({ length: count }, (_, i) => ({ id: String(i), xMm: (i - (count - 1) / 2) * (width + gap), zMm: 1, widthMm: width, thicknessMm: thickness })),
    planes: [{ zMm: 0 }],
    dielectrics: [{ zMm: 0, thicknessMm: 1, er, lossTangent: 0 }],
  }
}

test('geometry sweep matches H–J modes and an independent dielectric-image reference for weak mutual capacitance', () => {
  let maximum = 0
  for (const u of [.25, 1, 3]) for (const er of [2.2, 4, 10]) {
    const expected = singleMicrostrip(u, er)
    const result = solveCrossSection(fixture(u, 0, er, 1, .0001))
    const C = Math.sqrt(expected.ee) / (299792458 * expected.z)
    const L = expected.z * Math.sqrt(expected.ee) / 299792458
    maximum = Math.max(maximum, Math.abs(result.C[0][0] / C - 1), Math.abs(result.L[0][0] / L - 1))
  }
  // Actual DDR0 aspect ratio: 100 um wide, 35 um thick, 99.4 um above its reference.
  const thick = solveCrossSection(fixture(.1 / .0994, 0, 4.1, 1, .035 / .0994))
  const referenceThick = thickMicrostrip(.1 / .0994, 4.1, .035 / .0994)
  const thickError = Math.max(Math.abs(Math.sqrt(thick.L[0][0] / thick.C[0][0]) / referenceThick.z - 1), Math.abs(thick.C[0][0] / (Math.sqrt(referenceThick.ee) / (299792458 * referenceThick.z)) - 1), Math.abs(thick.L[0][0] / (referenceThick.z * Math.sqrt(referenceThick.ee) / 299792458) - 1))
  assert.ok(thickError < .02, `finite thickness H–J C/L/Z: ${thickError}`)
  let modal = 0
  for (const u of [.5, 1, 2]) for (const gap of [.2, .5, 2]) {
    const expected = coupledMicrostrip(u, gap, 4)
    const result = solveCrossSection(fixture(u, gap, 4, 2, .001))
    for (const [sign, ee, z] of [[1, expected.ee, expected.ze], [-1, expected.eo, expected.zo]]) {
      const C = result.C[0][0] + sign * result.C[0][1]
      const L = result.L[0][0] + sign * result.L[0][1]
      modal = Math.max(modal, Math.abs(C / (Math.sqrt(ee) / (299792458 * z)) - 1), Math.abs(L / (z * Math.sqrt(ee) / 299792458) - 1), Math.abs(Math.sqrt(L / C) / z - 1), Math.abs(Math.sqrt(L * C) * 299792458 / Math.sqrt(ee) - 1))
    }
  }
  assert.ok(maximum < .02, `single C/L sweep: ${maximum}`)
  assert.ok(modal < .02, `coupled C/L/Z/delay sweep: ${modal}`)
  // Small mutual C is a subtraction of empirical H–J modal coefficients; validate it against
  // a separate exact layered Green representation rather than infer a tight bound from that fit.
  let mutual = 0
  for (const [u, gap] of [[.5, 2], [2, 2]]) {
    const reference = imageMicrostrip(u, gap, 4)
    const refined = imageMicrostrip(u, gap, 4, 48)
    assert.ok(Math.abs(reference[0][1] / refined[0][1] - 1) < .001)
    const result = solveCrossSection(fixture(u, gap, 4, 2, .0001))
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) mutual = Math.max(mutual, Math.abs(result.C[i][j] / refined[i][j] - 1))
  }
  assert.ok(mutual < .01, `independent image C entries: ${mutual}`)
  console.log({ singleSweepPercent: 100 * maximum, coupledModalSweepPercent: 100 * modal, imageReferenceEntriesPercent: 100 * mutual, thickMicrostripPercent: 100 * thickError })
})
