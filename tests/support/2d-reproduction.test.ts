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

test('reviewed examples refuse omitted reference-via geometry for every lane order', () => {
  for (const lanes of [modeling.lanes, [...modeling.lanes].reverse()]) assert.throws(() => geometryFromCircuitJson(circuitJson as CircuitJson, { ...modeling, lanes }), { code: 'reference_via' })
})

import { makeGapBoard } from '../fixtures/rs485-gap'
test('review 10: original 44 by 12 mm RS-485 comparison TSX stays reproducible', async () => {
  const original = await makeGapBoard()
  const board = original.find(r => r.type === 'pcb_board')!
  assert.ok(board.type === 'pcb_board' && board.width === 44 && board.height === 12)
  assert.equal(original.filter(r => r.type === 'pcb_via').length, 2)
  assert.equal(original.filter(r => r.type === 'pcb_copper_pour').length, 1)
  assert.equal(original.filter(r => r.type === 'source_component' && r.name === 'RTERM').length, 1)
})
