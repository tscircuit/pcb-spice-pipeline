import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fullBoardDdr3 } from './full-board-ddr3'
import { prepareBlocks } from '../../src/pipeline/signals'

const path = process.env.SI_DDR3_BOARD

test('real full-board DDR3 TSX declarations reach the missing physical stackup boundary', { skip: !path || !process.env.IBIS_MODEL_DIR }, async () => {
  const circuit = await fullBoardDdr3(path!)
  assert.equal(circuit.filter(record => record.type === 'simulation_signal').length, 10)
  assert.equal(circuit.filter(record => record.type === 'pcb_trace').length, 651)
  assert.equal(circuit.filter(record => record.type === 'pcb_via').length, 1210)
  const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR}/${file}`)])))
  assert.throws(() => prepareBlocks(circuit, sources), /has no pcb_stackup/)
})
