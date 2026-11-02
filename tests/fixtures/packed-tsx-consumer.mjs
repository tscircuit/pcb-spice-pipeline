import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement as h} from 'react'
import {Circuit, analog} from 'tscircuit'
import {runPipeline, generateReport} from '@tscircuit/pcb-spice-pipeline'
import {ImportedBoard, serializeSimulation} from '@tscircuit/pcb-spice-pipeline/tsx'

// Synthetic declarations only; no model bytes, extraction or transient solver.
globalThis.fetch=async()=>{throw Error('Unexpected fetch during packed bridge test')}
const circuit=()=>new Circuit({platform:{partsEngineDisabled:true}})
const model={
  ibisModelAsset:{project_relative_path:'models/synthetic.ibs',url:'https://example.com/synthetic.ibs',mimetype:'text/plain'},
  ibisComponentName:'PART',ibisPinNameToPortLabel:{'1':'DATA','2':'GND','3':'VCC'},
  modelValueCorner:'typical',includePackageParasitics:false,
  ibisPinNameToReferencePortLabels:{'1':{pullup:'VCC',pulldown:'GND',powerClamp:'VCC',groundClamp:'GND'}},
}
const declarations=()=>[
  h('ibismodel',{...model,componentRef:'.U1',key:'model'}),
  h(analog.transientsimulation,{name:'SI',duration:'100ns',timePerStep:'10ps',spiceEngine:'pcb_spice',
    ibisPinStates:{'.U1 > .DATA':{isOutput:true,isOutputEnabled:true}},key:'transient'}),
  h('voltageprobe',{name:'RX',connectsTo:'.U1 > .DATA',referenceTo:'.U1 > .GND',key:'probe'}),
  h(analog.digitalstimulus,{name:'DATA',simulationRef:'.SI',sourcePinRef:'.U1 > .DATA',bitDuration:'2.5ns',startTime:'0ns',initialState:0,
    transmittedData:{transmissionType:'bits',bits:'0011',repeat:true},key:'stimulus'}),
  h(analog.eyediagram,{name:'RX_EYE',simulationRef:'.SI',probeRef:'.RX',unitInterval:'2.5ns',timeOrigin:'0ns',startTime:'20ns',key:'eye'}),
]
async function savedBoard() {
  const source=circuit()
  source.add(h('board',{width:10,height:10,routingDisabled:true,schematicDisabled:true},
    h('chip',{name:'U1',pinLabels:{pin1:'DATA',pin2:'GND',pin3:'VCC'},footprint:'sot23'})))
  await source.renderUntilSettled()
  const records=source.getCircuitJson().map(record=>structuredClone(record))
  for(const record of records)for(const key of ['source_component_id','source_port_id'])
    if(typeof record[key]==='string')record[key]=`saved_${record[key]}`
  return records
}

test('packed root and TSX exports preserve saved physical records and pin bindings',async()=>{
  assert.equal(typeof runPipeline,'function')
  assert.equal(typeof generateReport,'function')
  const original=await savedBoard(),before=structuredClone(original),imported=circuit()
  imported.add(h(ImportedBoard,{circuitJson:original},...declarations()))
  await imported.renderUntilSettled()
  const records=serializeSimulation(imported)
  assert.deepEqual(original,before)
  assert.deepEqual(records.slice(0,original.length),before)
  const component=original.find(r=>r.type==='source_component'&&r.name==='U1')
  const data=original.find(r=>r.type==='source_port'&&r.name==='DATA')
  const ground=original.find(r=>r.type==='source_port'&&r.name==='GND')
  const ibis=records.find(r=>r.type==='simulation_ibis_model')
  const probe=records.find(r=>r.type==='simulation_voltage_probe')
  assert.equal(ibis.source_component_id,component.source_component_id)
  assert.equal(ibis.ibis_pin_name_to_source_port_id['1'],data.source_port_id)
  assert.equal(probe.signal_input_source_port_id,data.source_port_id)
  assert.equal(probe.reference_input_source_port_id,ground.source_port_id)
  for(const type of ['simulation_experiment','simulation_digital_stimulus','simulation_eye_diagram'])
    assert.ok(records.some(r=>r.type===type),`Missing serialized ${type}`)
  console.log(JSON.stringify({stage:'packed-imported-board',physicalRecords:before.length,totalRecords:records.length,physicalPreserved:true,pinBindingsPreserved:true,solverExecuted:false}))
})

test('packed ImportedBoard still rejects added physical traces',async()=>{
  const original=await savedBoard(),before=structuredClone(original),imported=circuit()
  imported.add(h(ImportedBoard,{circuitJson:original},...declarations(),h('trace',{from:'.U1 > .DATA',to:'.U1 > .VCC'})))
  await imported.renderUntilSettled()
  assert.throws(()=>serializeSimulation(imported),/tsx_board.*native simulation declarations.*Trace/)
  assert.deepEqual(original,before)
})

test('packed ImportedBoard rejects a missing physical selector',async()=>{
  const original=await savedBoard(),before=structuredClone(original),imported=circuit()
  imported.add(h(ImportedBoard,{circuitJson:original},...declarations(),h('ibismodel',{...model,componentRef:'.MISSING'})))
  await assert.rejects(imported.renderUntilSettled(),/IBIS component selector.*MISSING/)
  assert.deepEqual(original,before)
})
