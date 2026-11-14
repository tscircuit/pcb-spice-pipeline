import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshot } from '../../src/kernel'

test('completed domain snapshots cannot be changed through shared inputs or consumers', () => {
  const source = { nodes: [{ id: 'n1' }] }
  const result = snapshot(source)
  source.nodes[0].id = 'changed'
  assert.equal(result.nodes[0].id, 'n1')
  assert.throws(() => {
    result.nodes[0].id = 'changed'
  }, TypeError)
  for (const value of [new Map(), new Set(), new Uint8Array(), () => undefined]) assert.throws(() => snapshot(value), /snapshots/)
})
