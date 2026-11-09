import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import EscapeViaPlane from '../../fixtures/escape-via-plane'
import { renderCoreSignals } from '../../support/core-render'
import { geometryFromCircuitJson } from '../../../src/board'
import { modeling } from '../../fixtures/native-channel'

test('real core escape vias at the end of ground routes reach the opposite-layer plane', { skip: !process.env.SI_CORE_MODULE }, async () => {
  const circuit = await renderCoreSignals(<EscapeViaPlane />)
  const settings = { ...modeling, viaPlatingMm: .018,
    lanes: [{ port: 'DATA', from: { component: 'TX', port: 'Y' }, to: { component: 'RX', port: 'A' } }] }
  assert.equal(circuit.filter(record => record.type === 'pcb_copper_pour').length, 1)
  assert.equal(circuit.filter(record => record.type === 'pcb_via').length, 2)
  const copper = geometryFromCircuitJson(circuit, settings).cells[0].routedCopper!
  assert.equal(copper.connections.length, 2)
  for (const path of copper.connections) {
    assert.ok(path.segments.some(segment => segment.a[2] !== segment.b[2]))
    assert.equal(path.contactRadiusMm, .15)
    const barrel = path.segments.at(-1)!
    assert.ok(Math.abs(barrel.widthMm * barrel.thicknessMm - Math.PI * (.118 ** 2 - .1 ** 2)) < 1e-12)
    assert.equal(barrel.b[2], (copper.pours[0].zMinMm + copper.pours[0].zMaxMm) / 2)
  }
  for (const kind of ['missing', 'wrong-net', 'bad-plating', 'wrong-span'] as const) {
    const invalid = structuredClone(circuit)
    const index = invalid.findIndex(record => record.type === 'pcb_via')
    const via = invalid[index]
    if (via.type !== 'pcb_via') throw new Error('Missing physical via')
    if (kind === 'missing') invalid.splice(index, 1)
    if (kind === 'wrong-net') via.source_net_id = 'unrelated-net'
    if (kind === 'bad-plating') via.outer_diameter = .21
    if (kind === 'wrong-span') via.to_layer = 'top'
    assert.throws(() => geometryFromCircuitJson(invalid, settings), /via_geometry|ground_connection/, kind)
  }
})
