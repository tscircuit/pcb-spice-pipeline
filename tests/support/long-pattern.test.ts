import test from 'node:test'
import assert from 'node:assert/strict'
import {admitBoard} from '../../src/board'
import {longPatternBoard} from '../fixtures/long-pattern'
test('100001-bit actual TSX traffic survives props, core serialization and Circuit JSON admission',async()=>{
  const bits='01'.repeat(50000)+'1'
  const circuit=await longPatternBoard(bits)
  const record=circuit.find(r=>r.type==='simulation_digital_stimulus')!
  assert.equal(record.type==='simulation_digital_stimulus'&&record.transmission_pattern.bits,bits)
  assert.doesNotThrow(()=>admitBoard(circuit))
})
