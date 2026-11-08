import {fixture} from './general.mjs'
export function inMemoryInput() {
  const {cj,m}=fixture()
  for(const component of cj.filter(record=>record.type==='source_component')) component.ftype='simple_chip'
  for(const state of cj.filter(record=>record.type==='simulation_ibis_pin_state')) {
    state.is_output=false
    delete state.is_output_enabled
  }
  for(const [pin,name] of [['rx-vdd','VDD'],['rx-gnd','GND']]) cj.push({type:'source_port',source_port_id:pin,source_component_id:'u1',name})
  cj.push({type:'source_trace',source_trace_id:'vdd',connected_source_port_ids:['v0','rx-vdd'],connected_source_net_ids:[]},
    {type:'source_trace',source_trace_id:'gnd',connected_source_port_ids:['g0','rx-gnd'],connected_source_net_ids:[]})
  const models=cj.filter(record=>record.type==='simulation_ibis_model')
  models[0].ibis_pin_name_to_source_port_id['3']='v0'
  models[0].ibis_pin_name_to_source_port_id['4']='g0'
  models[1].ibis_pin_name_to_source_port_id['3']='rx-vdd'
  models[1].ibis_pin_name_to_source_port_id['4']='rx-gnd'
  const circuitJson=cj.filter(record=>record.type!=='simulation_digital_stimulus')
  // This passive input-buffer fixture needs a physical edge, not a timestep-derived band.
  circuitJson.push({type:'simulation_voltage_source',simulation_voltage_source_id:'physical-pulse',source_component_id:'u0',
    terminal1_source_port_id:'p0',terminal2_source_port_id:'g0',wave_shape:'square',voltage:3.3,period:.002,
    rise_time:.0000125,fall_time:.0000125,pulse_width:.001})
  // Power-clamp voltage is VCC minus pad; negative dI/dV makes this synthetic clamp passive.
  const bytes=Buffer.from('[IBIS Ver] 4.2\r\n[Component] test\r\n[Pin] signal_name model_name\r\n1 D1 IN\r\n2 D2 IN\r\n3 VDD POWER\r\n4 VSS GND\r\n[Model] IN\r\nModel_type Input\r\nC_comp 1p 1p 1p\r\n[Voltage Range] 3.3 3.3 3.3\r\n[Power Clamp]\r\n-10 0.1 0.1 0.1\r\n10 -0.1 -0.1 -0.1\r\n[Gnd Clamp]\r\n-10 -0.2 -0.2 -0.2\r\n10 0.2 0.2 0.2\r\n[End]\r\n')
  return {circuitJson,modeling:m,ibisSources:{'models/test.ibs':bytes}}
}

export {fixtureSolver} from './solver.mjs'
