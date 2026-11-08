import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, mergeConductors, type CircuitJson } from '../../src/board'
import { circuitJson, modeling } from '../../examples/crosstalk/index.circuit'
import { circuitJson as via, modeling as viaModeling } from '../../examples/multilayer/index.circuit'

/** Selected physical TSX trace, mutable on a per-test clone. */
const trace = (cj: any[]): any => cj.find(r => r.type === 'pcb_trace' && cj.some(s => s.type === 'source_trace' && s.name === 'D0' && s.source_trace_id === r.source_trace_id))
for (const [code, change] of [
  ['stackup', (cj: any[]) => cj.splice(cj.findIndex(r => r.type === 'pcb_stackup'), 1)],
  ['ground_net', (cj: any[]) => { for (const r of cj) if (r.type === 'source_net') r.is_ground = false
    for (let i = cj.length - 1; i >= 0; i--) if (cj[i].type === 'simulation_voltage_source') cj.splice(i, 1) }],
  ['ground_reference', (cj: any[]) => { for (let i = cj.length - 1; i >= 0; i--) if (cj[i].type === 'source_port') cj.splice(i, 1) }],
  ['route_selection', (cj: any[]) => cj.splice(cj.indexOf(trace(cj)), 1)],
  ['endpoint_position', (cj: any[]) => { trace(cj).route[0].x += 2 }],
  ['layer_transition', (cj: any[]) => { trace(cj).route[1].layer = 'bottom' }],
  ['varying_width', (cj: any[]) => { for (const p of trace(cj).route) p.start_width = .1 }],
  ['route_type', (cj: any[]) => { trace(cj).route[1] = {route_type:'through_pad',start:{x:0,y:0},end:{x:1,y:1}} }],
  ['ground_geometry', (cj: any[]) => { cj.find(r => r.type === 'pcb_copper_pour').shape = 'polygon' }],
  ['slice_conductor', (cj: any[]) => { const p = structuredClone(cj.find(r => r.type === 'pcb_copper_pour'))
    p.source_net_id = 'unbound-copper'
    cj.push(p) }],
  ['slice_ground', (cj: any[]) => { for (let i = cj.length - 1; i >= 0; i--) if (cj[i].type === 'pcb_copper_pour' || cj[i].type === 'pcb_smtpad' || (cj[i].type === 'pcb_trace' && !cj.some(s => s.type === 'source_trace' && /^D\d$/.test(s.name) && s.source_trace_id === cj[i].source_trace_id))) cj.splice(i, 1) }],
  ['route_branch', (cj: any[]) => { cj.find(r => r.type === 'source_trace' && r.name === 'D0').connected_source_port_ids.push('extra-branch') }],

] as const) {
  test(`malformed TSX copper raises ${code}`, () => {
    const cj = structuredClone(circuitJson) as any[]
    change(cj)
    assert.throws(() => geometryFromCircuitJson(cj as CircuitJson, modeling), {code})
  })
}
test('bad lane intent and selectors have named diagnostics', () => {
  assert.throws(() => geometryFromCircuitJson(circuitJson as CircuitJson, {lanes:[]}), {code:'lanes'})
  assert.throws(() => geometryFromCircuitJson(circuitJson as CircuitJson, {lanes:[{...modeling.lanes[0],from:{component:'missing',port:'Y'}}]}), {code:'pin_mapping'})
})
test('via dimensions remain physical requirements', () => {
  const cj = structuredClone(via) as any[]
  delete cj.find(r => r.type === 'pcb_stackup').plated_hole_copper_thickness
  assert.throws(() => geometryFromCircuitJson(cj as CircuitJson, viaModeling), {code:'via_plating'})
  const missing = structuredClone(via).filter(r => r.type !== 'pcb_via') as CircuitJson
  assert.throws(() => geometryFromCircuitJson(missing, viaModeling), {code:'via_geometry'})
})
test('intersecting metal on different nets is a physical short', () => {
  const metal = {id:'a',group:0,xMin:0,xMax:1,zMin:0,zMax:.035,conductivitySm:5.8e7}
  assert.throws(() => mergeConductors({conductors:[metal,{...metal,id:'b',group:1}],dielectrics:[]}), {code:'conductor_overlap'})
})
