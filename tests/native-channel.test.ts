import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, fasterCapDeck, resolveRouteVias } from '../src/geometry.js'
import { circuitNodes } from '../src/declarations.js'
import { nativeChannel, modeling, curvedPoints } from './fixtures/native-channel.js'

test('native pcbPath resolves via dimensions from pcb_via', async () => {
  const circuit = await nativeChannel({ vias: true })
  const via = circuit.find(e => e.type === 'pcb_via' && e.pcb_trace_id)!
  assert.equal(via.type, 'pcb_via')
  assert.equal(via.outer_diameter, .3)
  assert.deepEqual(via.layers, ['top', 'inner1', 'inner2'])
  const geometry = geometryFromCircuitJson(circuit, modeling)
  assert.deepEqual(geometry.mappings[0].stages.filter(s => s.kind === 'via').map(s => s.holeMm), [.2, .2])
})

test('native via does not substitute an unrelated co-located via', async () => {
  const circuit = await nativeChannel({ vias: true })
  const trace = circuit.find(e => e.type === 'pcb_trace' && e.route.some(p => p.route_type === 'via'))!
  const via = circuit.find(e => e.type === 'pcb_via' && e.pcb_trace_id === trace.pcb_trace_id)!
  if (via.type !== 'pcb_via') throw new Error('expected via')
  via.pcb_trace_id = undefined
  via.subcircuit_connectivity_map_key = 'unrelated-net'
  assert.throws(() => resolveRouteVias(circuit, trace), /via_geometry/)
})

test('inline hole does not hide an associated physical via with incompatible layers', async () => {
  const circuit = await nativeChannel({ vias: true })
  const trace = circuit.find(e => e.type === 'pcb_trace' && e.route.some(p => p.route_type === 'via'))!
  const point = trace.route.find(p => p.route_type === 'via')!
  const via = circuit.find(e => e.type === 'pcb_via' && e.pcb_trace_id === trace.pcb_trace_id)!
  if (point.route_type !== 'via' || via.type !== 'pcb_via') throw new Error('expected vias')
  point.hole_diameter = via.hole_diameter
  via.layers = ['top', 'inner1']
  assert.throws(() => resolveRouteVias(circuit, trace), /via_geometry/)
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
