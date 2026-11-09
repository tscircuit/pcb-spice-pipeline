import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCircuitRecords } from '../../src/board'
import { modelingFromCircuitJson } from '../../src/pipeline'

test('channel schema accepts arbitrary lanes and rejects obsolete numerical controls', () => {
  const channel = { lanes: Array.from({length:12}, (_,i)=>({name:`D${i}`,driver_source_port_id:`a${i}`,receiver_source_port_id:`b${i}`})) }
  const experiment = {type:'simulation_experiment',simulation_experiment_id:'s',spice_engine:'pcb_spice',pcb_spice_channel:channel}
  const cj = [experiment] as never
  assert.equal(modelingFromCircuitJson(cj).lanes.length,12)
  validateCircuitRecords([{...experiment,experiment_type:'spice_transient_analysis',name:'SI',time_per_step:1e-6,end_time:1e-3}])
  assert.throws(()=>modelingFromCircuitJson([{...experiment,pcb_spice_channel:{...channel,sections:1}}] as never),{code:'pcb_spice_channel'})
})


test('review 2: actual settings-free TSX is admitted with an unpatched circuit-json peer', async () => {
  const { reviewBoard } = await import('../fixtures/review-geometry')
  const { simulation_experiment } = await import('circuit-json')
  const { circuitJson } = await reviewBoard()
  const record = circuitJson.find(r => r.type === 'simulation_experiment')!
  assert.equal(simulation_experiment.safeParse(record).success, false, 'upstream still requires the removed settings')
  validateCircuitRecords(circuitJson)
  assert.equal(modelingFromCircuitJson(circuitJson).lanes.length, 1)
})
