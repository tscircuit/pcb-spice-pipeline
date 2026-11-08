import test from 'node:test'
import assert from 'node:assert/strict'
import { modelingFromCircuitJson } from '../../src/pipeline'

test('channel schema accepts arbitrary lanes and rejects obsolete numerical controls', () => {
  const channel = { lanes: Array.from({length:12}, (_,i)=>({name:`D${i}`,driver_source_port_id:`a${i}`,receiver_source_port_id:`b${i}`})) }
  const cj = [{type:'simulation_experiment',simulation_experiment_id:'s',spice_engine:'pcb_spice',pcb_spice_channel:channel}] as never
  assert.equal(modelingFromCircuitJson(cj).lanes.length,12)
  assert.throws(()=>modelingFromCircuitJson([{...cj[0],pcb_spice_channel:{...channel,sections:1}}] as never),{code:'pcb_spice_channel'})
})
