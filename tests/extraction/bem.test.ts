import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCrossSection, solve, mu0, epsilon0, matrixResidual } from '../../src/extraction'
import type { CrossSection } from '../../src/board'

/** Finite physical microstrip fixture; thin metal approaches the published zero-thickness oracle. */
const microstrip = (): CrossSection => ({ conductors: [
  { id: 'signal', group: 0, xMin: -.5, xMax: .5, zMin: 1, zMax: 1.001, conductivitySm: 5.8e7 },
  { id: 'ground', group: -1, xMin: -20, xMax: 20, zMin: -.035, zMax: 0, conductivitySm: 5.8e7 },
], dielectrics: [{ xMin: -20, xMax: 20, zMin: 0, zMax: 1, er: 4, lossTangent: 0 }] })

test('2D microstrip independently matches Hammerstad–Jensen within 2%, with logged automatic convergence', () => {
  // E. Hammerstad & O. Jensen, Accurate Models for Microstrip Computer-Aided Design, MTT-S 1980.
  // Qucs technical manual eqs. 11.4–11.7, https://qucs.sourceforge.net/tech/node75.html
  const u = 1
  const er = 4
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + .432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7
  const b = .564 * ((er - .9) / (er + 3)) ** .053
  const ee = (er + 1) / 2 + (er - 1) / 2 * (1 + 10 / u) ** (-a * b)
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / u) ** .7528))
  const z = 60 * Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2)) / Math.sqrt(ee)
  const result = solveCrossSection(microstrip())
  const actualZ = Math.sqrt(mu0 * epsilon0 / (result.C[0][0] * result.C0[0][0]))
  assert.ok(Math.abs(actualZ / z - 1) < .02, `${actualZ} vs ${z}`)
  assert.ok(Math.abs(result.C[0][0] / result.C0[0][0] / ee - 1) < .02)
  assert.ok(result.steps.at(-1)!.residual! < .005)
  assert.ok(result.surface[0][0] > 0)
})
test('every matrix entry is checked, so small mutual changes cannot hide behind large diagonals', () => {
  assert.ok(matrixResidual([[100, -.001], [-.001, 100]], [[100, -.002], [-.002, 100]]) > .4)
  assert.throws(() => solve([[0]], [[1]]), { code: 'matrix_singular' })
})
