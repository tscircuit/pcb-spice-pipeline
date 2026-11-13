import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteEnergy } from '../../src/simulation/route-energy'
import { susceptanceEnergy } from '../../src/simulation/route-susceptance'

/** Sparse energy from a dense test matrix. */
function energy(values: number[][]): RouteEnergy {
  const result = new RouteEnergy(values.length)
  for (const [i, row] of values.entries()) for (const [j, value] of row.entries()) result.add(i, j, value)
  return result
}

/** Cell currents produced by the emitted flux-node G stamps for cell fluxes, I(i) = sum gain(i,j) * flux(j) / C(j). */
function currents(lines: string[], fluxes: number[]): number[] {
  const capacitance = new Map(lines.filter(line => line.startsWith('CTF')).map(line => [line.split(' ')[1], Number(line.split(' ')[3])]))
  const result = fluxes.map(() => 0)
  for (const line of lines.filter(line => /^GT_\d+_\d+ /.test(line))) {
    const [name, , , control, , gain] = line.split(' ')
    const j = Number(control.slice(2))
    result[Number(name.split('_')[1])] += Number(gain) * fluxes[j] / capacitance.get(control)!
  }
  return result
}

test('susceptance realizes the exact or truncated inverse inductance with passive flux nodes', () => {
  // A local L chain fills its inverse: K(0,2) is nonzero although L(0,2) is zero.
  const inductance = [[2e-9, .5e-9, 0, 0], [.5e-9, 2e-9, .5e-9, 0], [0, .5e-9, 2e-9, 0], [0, 0, 0, 3e-9]]
  const before = ['a', 'b', 'c', 'd']
  const after = ['e', 'f', 'g', 'h']
  const exact: string[] = []
  assert.deepEqual(susceptanceEnergy(exact, 'T', before, after, energy(inductance), 0), { cells: 4, components: 2, largestComponent: 3, inductancePairs: 2, inversePairs: 3, keptPairs: 3 })
  assert.ok(exact.includes('LT3 d h 3e-9'), 'an uncoupled cell stays one inductor')
  assert.ok(exact.includes('CTF0 Tf0 0 2e-9') && exact.includes('GTF0 0 Tf0 a e 1'), 'flux node integrates the cell voltage')
  // Fluxes from known currents through L must return those currents through K.
  const flowing = [3e-3, -1e-3, 2e-3]
  const fluxes = inductance.slice(0, 3).map(row => row.slice(0, 3).reduce((total, value, j) => total + value * flowing[j], 0))
  for (const [i, current] of currents(exact, fluxes).entries()) assert.ok(Math.abs(current - flowing[i]) < 1e-10 * Math.abs(flowing[i]), `cell ${i} current ${current}`)
  const truncated: string[] = []
  // |K(0,2)| / sqrt(K(0,0) K(2,2)) = 1/15; the nearest-neighbour terms are 0.258.
  assert.equal(susceptanceEnergy(truncated, 'T', before, after, energy(inductance), .1).keptPairs, 2)
  assert.ok(!truncated.some(line => line.startsWith('GT_0_2 ') || line.startsWith('GT_2_0 ')))
  assert.throws(() => susceptanceEnergy([], 'T', ['a', 'b'], ['c', 'd'], energy([[1e-9, 2e-9], [2e-9, 1e-9]]), 0), /not positive definite/)
  assert.throws(() => susceptanceEnergy([], 'T', before, after, energy(inductance), 1), /threshold/)
})
