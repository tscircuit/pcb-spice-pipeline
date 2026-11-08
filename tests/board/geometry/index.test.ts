import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, type CircuitJson } from '../../../src/board'
import { circuitJson, modeling } from '../../../examples/crosstalk/index.circuit'
import { circuitJson as via, modeling as viaModeling, makeBoard } from '../../../examples/multilayer/index.circuit'
import { fourLayerStackup } from '../../../examples/stackup'
import { drilledHoles } from '../../fixtures/drilled-holes'

test('segments preserve physical lengths and actual unequal neighbour positions', () => {
  const g = geometryFromCircuitJson(circuitJson as CircuitJson, modeling)
  for (const lane of g.mappings) {
    const segmented = g.cells.reduce((s, c) => s + (c.ports.some(p => p.lane === lane.port) ? c.lengthM * 1000 : 0), 0)
    assert.ok(Math.abs(segmented - lane.stages.reduce((s, v) => s + v.lengthMm, 0)) < 1e-6)
  }
  assert.ok(g.cells.some(c => c.ports.length === 3))
  assert.deepEqual(g, geometryFromCircuitJson(circuitJson as CircuitJson, { ...modeling, lanes: [...modeling.lanes].reverse() }))
})
test('removed numerical settings fail instead of being silently ignored', () => {
  assert.throws(() => geometryFromCircuitJson(circuitJson as CircuitJson, { ...modeling, sections: 1 } as never), { code: 'modeling_input' })
})
test('actual JSX drilled holes raise a named diagnostic instead of losing physical geometry', async () => {
  const holes = await drilledHoles()
  assert.equal(holes.length, 1)
  assert.throws(() => geometryFromCircuitJson([...circuitJson, ...holes], modeling), { code: 'slice_conductor' })
})
test('multilayer TSX derives actual via antipads and splits at plane edges and layers', () => {
  const g = geometryFromCircuitJson(via as CircuitJson, viaModeling)
  assert.equal(g.cells.filter(c=>c.via).length,2)
  assert.ok(g.cells.filter(c=>c.via).every(c=>Math.abs(c.via!.antipadMm-.7)<.001))
  // All dielectric layers crossed by these vias have Dk 4.1.
  assert.ok(g.cells.filter(c=>c.via).every(c=>Math.abs(c.via!.er-4.1)<1e-12))
  assert.ok(g.cells.some(c=>c.profile==='inner2'))
  const noHoles = structuredClone(via) as any[]
  for (const p of noHoles.filter(r=>r.type==='pcb_copper_pour')) p.brep_shape.inner_rings=[]
  assert.throws(()=>geometryFromCircuitJson(noHoles as CircuitJson,viaModeling),{code:'via_antipad'})
})
test('actual JSX solder mask is retained but does not set buried/through-via span permittivity', async () => {
  const mask = { layer_type:'soldermask', thickness:.02, relative_permittivity:3.3, dielectric_loss_tangent:.025 }
  const masked = await makeBoard({ ...fourLayerStackup, layers:[mask, ...fourLayerStackup.layers, mask] })
  const g = geometryFromCircuitJson(masked, viaModeling)
  assert.equal(g.stackup.dielectrics.filter(d=>d.material==='soldermask').length, 2)
  assert.ok(Math.abs(g.stackup.copperLayers.find(c=>c.name==='bottom')!.zMaxMm)<1e-12)
  assert.ok(g.stackup.dielectrics.some(d=>d.relativePermittivity===3.3 && d.lossTangent===.025))
  assert.ok(Math.abs(g.stackup.relativePermittivity-4.1)>.01)
  assert.ok(g.cells.filter(c=>c.via).every(c=>Math.abs(c.via!.er-4.1)<1e-12))
})
