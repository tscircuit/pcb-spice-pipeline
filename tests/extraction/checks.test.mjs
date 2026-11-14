import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMatrix } from '../../src/extraction/index.js'

test('a reciprocal positive-definite matrix is symmetrized with its Cholesky proof', () => {
  const checked = validateMatrix([[7, 5], [5, 8]], 'R')
  assert.deepEqual(checked.matrix, [[7, 5], [5, 8]])
  assert.equal(checked.reciprocityResidual, 0)
})

test('nonpassive, nonreciprocal, malformed and zero matrices fail before normalization', () => {
  assert.throws(() => validateMatrix([[1, 2], [2, 1]], 'L'), /passivity/)
  assert.throws(() => validateMatrix([[1, .2], [.5, 1]], 'C'), /reciprocity/)
  assert.throws(() => validateMatrix([[1, 2]], 'X'), { code: 'matrix_format', message: 'matrix_format: X: finite square matrix required' })
  assert.throws(() => validateMatrix([[0]], 'X'), { code: 'matrix_zero' })
})
