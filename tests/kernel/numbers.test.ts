import test from 'node:test'
import assert from 'node:assert/strict'
import { min, max } from '../../src/kernel'

test('numeric reductions accept arrays larger than the JavaScript argument limit', () => {
  const values = Array.from({ length: 250000 }, (_, i) => i)
  assert.equal(min(values), 0)
  assert.equal(max(values), 249999)
  assert.equal(min([]), Infinity)
  assert.equal(max([]), -Infinity)
})
