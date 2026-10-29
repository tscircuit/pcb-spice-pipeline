import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, fastHenryDeck, fasterCapDeck } from '../src/geometry.js'
import { parseRecord } from '../src/schema.js'
import { modeling } from './fixtures/native-channel.js'
import { viaInPad } from './fixtures/via-in-pad.js'

test('native via-in-pad references reach the inner ground plane', async () => {
  const circuit = await viaInPad()
  assert.deepEqual(circuit.filter(e => e.type.endsWith('_error')), [])
  for (const record of circuit.filter(e => ['pcb_smtpad', 'pcb_via', 'pcb_copper_pour'].includes(e.type))) parseRecord(record)
  const cell = geometryFromCircuitJson(circuit, modeling).cells[0], copper = cell.routedCopper!
  assert.match(fastHenryDeck(cell, modeling.extraction), /\.external/)
  assert.ok(fasterCapDeck(cell, modeling.extraction)['return.txt'].includes('return'))
  assert.equal(copper.connections.length, 2)
  for (const path of copper.connections) {
    assert.equal(path.segments.length, 1)
    assert.notEqual(path.terminals[0][2], path.terminals[1][2])
    assert.equal(path.contactRadiusMm, .15)
  }
})

test('an offset barrel fully within the pad produces a physical pad connection', async () => {
  const circuit = await viaInPad({ offset: .04 })
  const connections = geometryFromCircuitJson(circuit, modeling).cells[0].routedCopper!.connections
  for (const path of connections) {
    assert.equal(path.segments.length, 2)
    assert.ok(Math.abs(path.segments[0].b[0] - path.segments[0].a[0] - .04) < 1e-9)
  }
})

test('direct contacts reject disconnected, wrong-net, out-of-span, missing and ambiguous vias', async () => {
  for (const options of [
    { offset: .4 }, { viaNet: 'other' as const }, { viaEnd: 'inner1' as const, planeLayer: 'inner2' as const },
    { planeMiss: true }, { planeEdge: -3.25 }, { duplicate: true },
  ]) {
    const circuit = await viaInPad(options)
    assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_(connection|geometry)/, JSON.stringify(options))
  }
})

test('direct contacts validate barrel plating and omitted stubs', async () => {
  const circuit = await viaInPad()
  assert.throws(() => geometryFromCircuitJson(circuit, { ...modeling, viaPlatingMm: .08 }), /via_geometry/)
  assert.throws(() => geometryFromCircuitJson(circuit, { ...modeling, omitThroughViaStubs: false }), /via_stub/)
})

// Explicitly conflicting metadata is difficult to express as valid native TSX.
test('a native via with conflicting electrical metadata is not accepted', async () => {
  const circuit = await viaInPad()
  const via = circuit.find(e => e.type === 'pcb_via')!
  const signal = circuit.find(e => e.type === 'source_net' && e.name === 'DQ')!
  if (via.type !== 'pcb_via' || signal.type !== 'source_net') throw Error('fixture')
  via.source_net_id = signal.source_net_id
  parseRecord(via)
  assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_connection/)
})

test('a via with conflicting declared span cannot reach the pour', async () => {
  const circuit = await viaInPad()
  const via = circuit.find(e => e.type === 'pcb_via')!
  if (via.type !== 'pcb_via') throw Error('fixture')
  via.to_layer = 'inner2'
  parseRecord(via)
  assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_connection/)
})

test('a via center inside the pour is insufficient when the barrel crosses its edge', async () => {
  const circuit = await viaInPad({ planeEdge: -3.25 })
  const pour = circuit.find(e => e.type === 'pcb_copper_pour')!
  if (pour.type !== 'pcb_copper_pour' || pour.shape !== 'brep') throw Error('fixture')
  assert.ok(Math.abs(Math.min(...pour.brep_shape.outer_ring.vertices.map(p => p.x)) + 3.05) < 1e-9)
  assert.throws(() => geometryFromCircuitJson(circuit, modeling), /ground_connection/)
})
