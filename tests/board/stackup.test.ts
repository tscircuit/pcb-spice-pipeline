import test from 'node:test'
import assert from 'node:assert/strict'
import { stackupFromCircuitJson, type CircuitJson } from '../../src/board'
import { circuitJson } from '../../examples/crosstalk/index.circuit'

test('construction retains copper, dielectric loss and plating from original records', () => {
  const s = stackupFromCircuitJson(circuitJson as CircuitJson)
  assert.equal(s.viaPlatingMm, .025)
  assert.equal(s.dielectrics[0].lossTangent, .02)
  assert.equal(s.copperLayers[0].conductivitySm, 5.8e7)
})
for (const [field, code] of [['relative_permittivity', 'stackup_permittivity'], ['loss_tangent', 'stackup_loss'], ['electrical_conductivity_s_per_m', 'stackup_conductivity']] as const) {
  test(`missing physical ${field} has named diagnostic ${code}`, () => {
    const cj = structuredClone(circuitJson) as CircuitJson
    const stack = cj.find(r => r.type === 'pcb_stackup')!
    if (stack.type !== 'pcb_stackup') throw Error('fixture')
    for (const layer of stack.layers) Reflect.deleteProperty(layer, field)
    assert.throws(() => stackupFromCircuitJson(cj), { code })
  })
}
