import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import Board from '../fixtures/return-agreement'
import { renderCoreSignals } from '../support/core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes } from '../../src/board'
import { extractRoutes } from '../../src/extraction'

test('TSX parallel coupling uses solved electric AND magnetic coupling instead of a millimetre horizon', async () => {
  for (const spacing of [.3, 16]) {
    const circuit = await renderCoreSignals(<Board spacing={spacing} />)
    const selected = new Set(circuit.filter(record => record.type === 'source_trace').filter(record => record.connected_source_port_ids.length === 2).flatMap(trace => trace.connected_source_port_ids))
    const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
    const scope = channelCopperScope(circuit, selected, connectedSourceIds(circuit, ground.source_net_id))
    scope.lateralDistanceMm = 32
    const result = extractRoutes(segmentRoutes(circuit, scope), { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 })
    assert.equal(Math.max(...result.slices.map(slice => slice.wires.length)), spacing < 1 ? 3 : 1,
      'Nearby wires stay coupled; distant wires split only after both normalized mutuals fall below 0.5%')
  }
})
