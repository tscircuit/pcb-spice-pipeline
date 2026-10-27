import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, fasterCapDeck } from '../src/geometry.js'
import { circuitNodes } from '../src/declarations.js'
import { nativeChannel, modeling, curvedPoints } from './fixtures/native-channel.js'

test('repro: native pcbPath via dimensions live in pcb_via', async () => {
  const circuit = await nativeChannel({ vias: true })
  const via = circuit.find(e => e.type === 'pcb_via' && e.pcb_trace_id)!
  assert.equal(via.type, 'pcb_via')
  assert.throws(() => geometryFromCircuitJson(circuit, modeling), /modeling_input.*via_hole_diameter/)
})

test('repro: component net bindings short the selected native channel', async () => {
  const circuit = await nativeChannel({ netBindings: true })
  const geometry = geometryFromCircuitJson(circuit, modeling)
  assert.throws(() => circuitNodes(circuit, geometry, modeling), /channel_short/)
})

test('repro: a three-point native route breaks the copper slab union', async () => {
  const circuit = await nativeChannel({ points: curvedPoints })
  const geometry = geometryFromCircuitJson(circuit, modeling)
  assert.throws(() => fasterCapDeck(geometry.cells[0], modeling.extraction), /SweepLine tree/)
})
