import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, type CircuitJson, stackupFromCircuitJson } from '../../../src/board'
import { circuitJson, modeling } from '../../../examples/crosstalk/index.circuit'
import { circuitJson as via, modeling as viaModeling, makeBoard } from '../../../examples/multilayer/index.circuit'
import { fourLayerStackup } from '../../../examples/stackup'
import { drilledHoles } from '../../fixtures/drilled-holes'

test('supported parallel TSX preserves copper lengths, unequal neighbours and lane order', async () => {
  const { circuitJson, modeling } = await reviewBoard({ parallel: true })
  const g = geometryFromCircuitJson(circuitJson, modeling)
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
test('multilayer TSX retains selected antipads and diagnoses varying polygon slices', () => {
  assert.throws(() => geometryFromCircuitJson(via as CircuitJson, viaModeling), { code: 'varying_cross_section' })
  assert.ok(via.some(r => r.type === 'pcb_via' && r.layers.includes('inner2')))
  const noHoles = structuredClone(via) as any[]
  for (const p of noHoles.filter(r=>r.type==='pcb_copper_pour')) p.brep_shape.inner_rings=[]
  assert.throws(()=>geometryFromCircuitJson(noHoles as CircuitJson,viaModeling),{code:'via_antipad'})
})
test('actual JSX mask construction stays intact when varying slices are rejected', async () => {
  const mask = { layer_type:'soldermask', thickness:.02, relative_permittivity:3.3, dielectric_loss_tangent:.025 }
  const masked = await makeBoard({ ...fourLayerStackup, layers:[mask, ...fourLayerStackup.layers, mask] })
  assert.throws(() => geometryFromCircuitJson(masked, viaModeling), { code: 'varying_cross_section' })
  const g = { stackup: stackupFromCircuitJson(masked) }
  assert.equal(g.stackup.dielectrics.filter(d=>d.material==='soldermask').length, 2)
  assert.ok(Math.abs(g.stackup.copperLayers.find(c=>c.name==='bottom')!.zMaxMm)<1e-12)
  assert.ok(g.stackup.dielectrics.some(d=>d.relativePermittivity===3.3 && d.lossTangent===.025))
  assert.ok(Math.abs(g.stackup.relativePermittivity-4.1)>.01)
})

import { reviewBoard } from '../../fixtures/review-geometry'

test('review 1: oblique driven lanes never become neutral floating copper', async () => {
  const { circuitJson, modeling } = await reviewBoard({ oblique: true })
  assert.throws(() => geometryFromCircuitJson(circuitJson, modeling), { code: 'oblique_coupling' })
})
test('review 5: sloping return boundaries never become one midpoint extrusion', async () => {
  const { circuitJson, modeling } = await reviewBoard({ slopingPour: true })
  assert.throws(() => geometryFromCircuitJson(circuitJson, modeling), { code: 'varying_cross_section' })
})

test('review 7: endpoint pads include connected open overhangs', async () => {
  const { circuitJson, modeling } = await reviewBoard({ padWidth: 2 })
  const g = geometryFromCircuitJson(circuitJson, modeling)
  assert.equal(Math.min(...g.cells.map(c => c.start[0])), -6)
  assert.equal(Math.max(...g.cells.map(c => c.end[0])), 6)
  assert.ok(g.cells.some(c => c.ports.some(p => p.from === 'IN0' || p.to === 'IN0')))
  assert.ok(g.cells.some(c => c.ports.some(p => p.from === 'OUT0' || p.to === 'OUT0')))
  assert.equal(g.cells.reduce((s, c) => s + c.lengthM * 1000, 0), 12)
})
