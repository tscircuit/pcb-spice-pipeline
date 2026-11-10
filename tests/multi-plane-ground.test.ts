import test from 'node:test'
import assert from 'node:assert/strict'
import { fastHenryDeck, geometryFromCircuitJson } from '../src/geometry.js'
import { connectedSourceIds } from '../src/copper.js'
import { parseRecord } from '../src/schema.js'
import { modeling } from './fixtures/native-channel.js'
import { multiPlaneGround } from './fixtures/multi-plane-ground.js'

const layers = ['inner1', 'inner3', 'inner6'] as const

test('native multi-plane fixture has two reference barrels contacting three GND pours', async () => {
  const circuit = await multiPlaneGround()
  assert.deepEqual(circuit.filter(e => e.type.endsWith('_error')), [])
  const vias = circuit.filter(e => e.type === 'pcb_via')
  const pours = circuit.filter(e => e.type === 'pcb_copper_pour')
  const ground = circuit.find(e => e.type === 'source_net' && e.name === 'GND')!
  assert.equal(ground.type, 'source_net')
  assert.equal(vias.length, 2)
  assert.deepEqual(pours.map(p => p.layer).sort(), [...layers].sort())
  for (const record of [...vias, ...pours]) parseRecord(record)
  for (const via of vias) {
    assert.equal(via.from_layer, 'top')
    assert.equal(via.to_layer, 'inner6')
    assert.equal(via.hole_diameter, .15)
    assert.equal(via.outer_diameter, .3)
    const associated = connectedSourceIds(circuit, ground.source_net_id)
    const sourceTrace = circuit.find(e => e.type === 'source_trace' && e.source_trace_id === via.source_trace_id)
    assert.ok((via.source_net_id && associated.has(via.source_net_id)) || (sourceTrace?.type === 'source_trace' && sourceTrace.connected_source_port_ids.some(id => associated.has(id))))
    const pad = circuit.find(e => e.type === 'pcb_smtpad' && e.shape === 'circle' && Math.hypot(e.x - via.x, e.y - via.y) < 1e-8)
    assert.ok(pad && pad.type === 'pcb_smtpad' && pad.shape === 'circle' && pad.radius >= via.outer_diameter / 2)
    const port = circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === pad.pcb_port_id)
    assert.ok(port && port.type === 'pcb_port' && port.source_port_id && associated.has(port.source_port_id))
    for (const pour of pours) {
      assert.equal(pour.source_net_id, ground.source_net_id)
      assert.ok(via.layers.includes(pour.layer))
      assert.equal(pour.shape, 'brep')
      assert.equal(pour.brep_shape.inner_rings.length, 0)
      // This fixture's BREP is a rectangle; prove the complete plated disk is inside it.
      const vertices = pour.brep_shape.outer_ring.vertices
      const xs = vertices.map(p => p.x), ys = vertices.map(p => p.y), radius = via.hole_diameter / 2 + modeling.viaPlatingMm!
      assert.equal(vertices.length, 4)
      assert.equal(new Set(xs).size, 2)
      assert.equal(new Set(ys).size, 2)
      assert.ok(via.x - Math.min(...xs) > radius && Math.max(...xs) - via.x > radius)
      assert.ok(via.y - Math.min(...ys) > radius && Math.max(...ys) - via.y > radius)
    }
  }
})

test('extract connected reference vias through all three ground planes', { todo: 'Requires a multi-plane return network with intermediate barrel contacts' }, async () => {
  const circuit = await multiPlaneGround()
  const cell = geometryFromCircuitJson(circuit, modeling).cells[0], copper = cell.routedCopper!
  assert.equal(copper.connections.length, 2)
  assert.deepEqual(copper.pours.map(p => p.layer).sort(), [...layers].sort())
  // The paths must split at every contacted plane, not stop at an arbitrary one.
  for (const path of copper.connections) {
    for (const pour of copper.pours) {
      const z = (pour.zMinMm + pour.zMaxMm) / 2
      assert.ok(path.segments.some(s => Math.abs(s.b[2] - z) < 1e-8))
    }
  }
  const deck = fastHenryDeck(cell, modeling.extraction)
  for (const [index] of copper.pours.entries()) {
    const contactNodes = new Set([...deck.matchAll(new RegExp(`^\\.equiv (\\S+) Np${index}_\\d+$`, 'gm'))].map(match => match[1]))
    assert.equal(contactNodes.size, 2, `both reference barrels must join plane ${index}`)
  }
})
