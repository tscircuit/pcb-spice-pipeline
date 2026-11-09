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
  }
})
