import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteEnergy, seriesEnergy, shuntEnergy } from '../../src/simulation/route-energy'

/** Assemble in reverse order to verify dense-compatible column ordering. */
function energy(values: number[][]): RouteEnergy {
  const result = new RouteEnergy(values.length)
  for (let i = values.length - 1; i >= 0; i--) for (let j = values.length - 1; j >= 0; j--) result.add(i, j, values[i][j])
  return result
}

test('sparse series realization equals dense self and signed mutual coefficients', () => {
  const matrix = energy([[4e-9, 1e-9, 0], [1e-9, 9e-9, -3e-9], [0, -3e-9, 16e-9]])
  const lines: string[] = []
  seriesEnergy(lines, 'T', ['a', 'b', 'c'], ['d', 'e', 'f'], matrix, 'L')
  assert.deepEqual(lines, ['LT0 a d 4e-9', 'LT1 b e 9e-9', 'LT2 c f 1.6e-8', 'KT0_1 LT0 LT1 0.166666666667', 'KT1_2 LT1 LT2 -0.25'])
  assert.equal(matrix.rows.reduce((sum, row) => sum + row.size, 0), 7)
  assert.deepEqual(matrix.scaled(2).entries(0), [[0, 8e-9], [1, 2e-9]])
})

test('sparse Maxwell shunts preserve dense row sums, pair ordering and Foster loss', () => {
  const lines: string[] = []
  shuntEnergy(lines, 'T', ['a', 'b', 'c'], energy([[4e-12, -1e-12, 0], [-1e-12, 5e-12, -2e-12], [0, -2e-12, 6e-12]]))
  assert.deepEqual(lines, ['CTS0 a 0 3e-12', 'CTS1 b 0 2e-12', 'CTS2 c 0 4e-12', 'CTS3 a b 1e-12', 'CTS4 b c 2e-12'])
  const loss: string[] = []
  shuntEnergy(loss, 'T', ['a'], energy([[1e-12]]), 1e9)
  assert.deepEqual(loss, ['CTS0 a TS0c 1e-12', 'RTS0 TS0c 0 1000'])
})

test('memory admission counts actual entries, including hybrid dense couplings, rather than cells', () => {
  const sparse = new RouteEnergy(2000)
  for (let i = 0; i < 2000; i++) sparse.add(i, i, 1)
  assert.equal(sparse.rows.reduce((sum, row) => sum + row.size, 0), 2000)
  const budget = { entries: 499999 }
  const bounded = new RouteEnergy(2, budget)
  bounded.add(0, 0, 1)
  bounded.add(0, 0, 1)
  assert.throws(() => bounded.add(0, 1, .1), /sparse-memory limit/)
})
