import test from 'node:test'
import assert from 'node:assert/strict'
import { sectionFactor, sectionInverse, sectionPassive } from '../../src/extraction/cross-section-matrix'

test('boundary factor reuses pivoting for independent excitations and rejects singular/nonpassive energy', () => {
  const matrix = [[0, 1, 2], [1, 3, 1], [2, 1, 4]]
  const solve = sectionFactor(matrix.map(row => Float64Array.from(row)))
  for (const rhs of [[[1, 0], [0, 1], [0, 0]], [[1], [-2], [3]]]) {
    const x = solve(rhs)
    for (let i = 0; i < 3; i++) for (let j = 0; j < rhs[0].length; j++) assert.ok(Math.abs(matrix[i].reduce((s, v, k) => s + v * x[k][j], 0) - rhs[i][j]) < 1e-12)
  }
  const inverse = sectionInverse([[2, 1], [1, 2]])
  assert.ok(Math.abs(inverse[0][0] - 2 / 3) < 1e-14)
  assert.throws(() => sectionFactor([Float64Array.of(0)]), { code: 'matrix_zero' })
  sectionPassive([[0, 0], [0, 1]])
  assert.throws(() => sectionPassive([[0]], true), { code: 'passivity' })
  assert.throws(() => sectionPassive([[1, 2], [2, 1]]), { code: 'passivity' })
})
