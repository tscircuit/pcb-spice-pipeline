import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalInductance } from '../../src/simulation'

test('explicit vertical terminal corrections preserve geometry scaling, reciprocity and passive coupling', () => {
  const line = [[.55e-6, .22e-6], [.22e-6, .55e-6]]
  const positions: [number, number][] = [[0, 0], [0, .3]]
  const matrix = terminalInductance(.4, .15, .075, positions, line)
  assert.ok(matrix[0][0] > .09e-9 && matrix[0][0] < .11e-9)
  assert.ok(matrix[0][1] > .01e-9 && matrix[0][1] < .025e-9)
  assert.equal(matrix[0][1], matrix[1][0])
  const scaled = terminalInductance(.8, .3, .15, [[0, 0], [0, .6]], line)
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(Math.abs(scaled[i][j] - 2 * matrix[i][j]) < 1e-24)
  assert.throws(() => terminalInductance(0, .15, .075, positions, line), /dimensions/)
  assert.throws(() => terminalInductance(.4, .15, .075, [[0, 0], [0, .1]], line), /overlap/)
})
