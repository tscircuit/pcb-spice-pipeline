import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, fasterCapDeck } from '../src/geometry.js'
import { circuitNodes } from '../src/declarations.js'
import { nativeChannel, modeling, curvedPoints } from './fixtures/native-channel.js'

test('native pcbPath resolves via dimensions from pcb_via', async () => {
  const circuit = await nativeChannel({ vias: true })
  const via = circuit.find(e => e.type === 'pcb_via' && e.pcb_trace_id)!
  assert.equal(via.type, 'pcb_via')
  const geometry = geometryFromCircuitJson(circuit, modeling)
  assert.deepEqual(geometry.mappings[0].stages.filter(s => s.kind === 'via').map(s => s.holeMm), [.2, .2])
})

test('component net bindings preserve distinct channel endpoints', async () => {
  const circuit = await nativeChannel({ netBindings: true })
  const geometry = geometryFromCircuitJson(circuit, modeling)
  const nodes = circuitNodes(circuit, geometry, modeling), lane = geometry.mappings[0]
  assert.notEqual(nodes.node(lane.from), nodes.node(lane.to))
})

test('a three-point native route prepares the copper slab union', async () => {
  const circuit = await nativeChannel({ points: curvedPoints })
  const geometry = geometryFromCircuitJson(circuit, modeling)
  assert.doesNotThrow(() => fasterCapDeck(geometry.cells[0], modeling.extraction))
})
