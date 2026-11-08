import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, type CircuitJson, type BoardModeling } from '../../src/board'
import { circuitJson, modeling } from '../../examples/crosstalk/index.circuit'
import { circuitJson as multilayer } from '../../examples/multilayer/index.circuit'

test('real TSX reproductions include SC70 pads, three distinct routes and a layer-changing split-pour board', () => {
  assert.equal(circuitJson.filter(r => r.type === 'simulation_ibis_model').length, 6)
  assert.ok(circuitJson.filter(r => r.type === 'pcb_smtpad').length >= 30)
  assert.ok(multilayer.some(r => r.type === 'pcb_via'))
  assert.ok(multilayer.some(r => r.type === 'pcb_copper_pour'))
})

test('AFTER: lane permutations produce identical real-copper segment maps', () => {
  const forward = geometryFromCircuitJson(circuitJson as CircuitJson, modeling)
  const permuted = geometryFromCircuitJson(circuitJson as CircuitJson, { ...modeling, lanes: [modeling.lanes[0], modeling.lanes[2], modeling.lanes[1]] })
  assert.deepEqual(forward, permuted)
  assert.ok(forward.cells.some(c => c.ports.length === 3))
  assert.ok(forward.cells.some(c => c.slice?.conductors.some(s => s.group === -1 && s.xMax - s.xMin > 20)))
})
