import test from 'node:test'
import assert from 'node:assert/strict'
import type { RouteSpatialWaveform } from '../../src/simulation'

test('spatial capture transports board coordinates and point-major voltages as JSON', () => {
  const waveform: RouteSpatialWaveform = { points: [{ node: 'route1', net: 'DATA', layer: 'top', x: -4, y: .35 }], timeSeconds: [0, 1e-9], volts: [[0, 3.3]] }
  assert.deepEqual(JSON.parse(JSON.stringify(waveform)), waveform)
})
