import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import Board from '../fixtures/return-agreement'
import { renderCoreSignals } from '../support/core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes } from '../../src/board'
import { RouteFieldsSolver } from '../../src/extraction'

test('TSX parallel coupling uses solved electric AND magnetic coupling instead of a millimetre horizon', async () => {
  for (const [spacing, thickness] of [[.3, .4], [16, .4], [4, 1.6]]) {
    const circuit = await renderCoreSignals(<Board spacing={spacing} thickness={thickness} />)
    const selected = new Set(circuit.filter(record => record.type === 'source_trace').filter(record => record.connected_source_port_ids.length === 2).flatMap(trace => trace.connected_source_port_ids))
    const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
    const scope = channelCopperScope(circuit, selected, connectedSourceIds(circuit, ground.source_net_id), new Set(), 32)
    const result = ((solver: RouteFieldsSolver) => {
    solver.solve()
    return solver.getOutput().value
  }) (new RouteFieldsSolver({ geometry: segmentRoutes(circuit, scope), materials: { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 }, artifactPrefix: 'test' }))
    assert.equal(Math.max(...result.slices.map(slice => slice.wires.length)), spacing < 8 ? 3 : 1,
      'Nearby wires stay coupled; distant wires split only after both normalized mutuals fall below 0.5%')
  }
})
