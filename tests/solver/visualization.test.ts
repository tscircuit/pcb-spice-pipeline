import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyVisualization } from '../../src/solver'

test('solver compatibility emits only an empty coordinate object', () => {
  assert.deepEqual(emptyVisualization(), { coordinateSystem: 'cartesian' })
})
