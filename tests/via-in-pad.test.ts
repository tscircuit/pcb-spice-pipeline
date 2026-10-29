import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson } from '../src/geometry.js'
import { modeling } from './fixtures/native-channel.js'
import { viaInPad } from './fixtures/via-in-pad.js'

test('native via-in-pad references reach the inner ground plane', { todo: 'extractor currently requires a routed ground lead' }, async () => {
  const circuit = await viaInPad()
  assert.deepEqual(circuit.filter(e => e.type.endsWith('_error')), [])
  const copper = geometryFromCircuitJson(circuit, modeling).cells[0].routedCopper!
  assert.equal(copper.connections.length, 2)
  for (const path of copper.connections) {
    assert.equal(path.segments.length, 1)
    assert.notEqual(path.terminals[0][2], path.terminals[1][2])
    assert.equal(path.contactRadiusMm, .15)
  }
})
