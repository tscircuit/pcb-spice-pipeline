import test from 'node:test'
import assert from 'node:assert/strict'
import { routeReceiverLimits, routeTickStep, routeUnitScale, routeWaveformDrawing } from '../../src/simulation'
import type { RoutedCapture } from '../../src/simulation'
import type { RouteBuffer } from '../../src/simulation/routed-types'
import { sha256 } from '../../src/kernel'
import { assertRouteVisual } from '../support/routed-visual-fixture'

// Synthetic drawing data only: irregular sampling, an overshoot and an undershoot.
const capture: Extract<RoutedCapture, { kind: 'completed' }> = {
  kind: 'completed',
  qualification: 'candidate-unqualified',
  timestampsSeconds: [0, 0.2e-9, 0.21e-9, 0.25e-9, 1e-9],
  probes: [
    { name: 'A', sourcePortId: 'a', voltageLevels: [0, 0.8, 2.1, 1.5, 1.5] },
    { name: 'B', sourcePortId: 'b', voltageLevels: [0, 0.1, -0.5, 0.05, 0] },
  ],
}
const box = { minX: 0, maxX: 300, minY: 0, maxY: 120 }

test('waveform stays inside its panel with auto-scaled axes, given limits and per-probe colours', () => {
  const original = structuredClone(capture)
  const drawing = routeWaveformDrawing(capture, 1e-9, box, { limits: [{ voltage: 0.8, label: 'Vinl 0.8 V' }], colors: ['#111111', '#222222'] })
  assertRouteVisual(drawing, 'simulation', 'waveform-visual')
  assert.deepEqual(capture, original, 'pure drawing never mutates results')
  const b = drawing.lines!.find((line) => line.label === 'B')!
  assert.equal(b.strokeColor, '#222222')
  assert.equal(b.points.length, capture.timestampsSeconds.length)
  assert.ok(drawing.texts!.some((text) => text.text === '1 ns'), 'time unit picked from the duration')
  assert.ok(drawing.texts!.some((text) => text.text === 'Vinl 0.8 V' && text.color === '#dc2626'))
  for (const point of drawing.lines!.flatMap((line) => line.points)) assert.ok(point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY)
})

test('no limits are drawn unless the records provide them', () => {
  const drawing = routeWaveformDrawing(capture, 1e-9, box)
  assert.equal(drawing.lines!.filter((line) => line.strokeColor === '#dc2626').length, 0)
})

test('axes scale to any voltage and time range with SI units', () => {
  assert.deepEqual(routeUnitScale(40e-9), { scale: 1e9, prefix: 'n' })
  assert.deepEqual(routeUnitScale(576e-6), { scale: 1e6, prefix: 'µ' })
  assert.deepEqual(routeUnitScale(12), { scale: 1, prefix: '' })
  assert.equal(routeTickStep(3.3, 5), 1)
  assert.equal(routeTickStep(0.05, 5), 0.01)
  const millivolts = routeWaveformDrawing({ ...capture, probes: [{ ...capture.probes[0], voltageLevels: [0, 0.01, 0.02, 0.015, 0.01] }] }, 2e-3, box)
  assert.ok(millivolts.texts!.some((text) => text.text === '20 mV'))
  assert.ok(millivolts.texts!.some((text) => text.text === '2 ms'))
})

test('pending and failed results are honest banners with no invented probe traces', () => {
  assertRouteVisual(routeWaveformDrawing(undefined, 1e-9, box), 'simulation', 'waveform-visual-pending')
  const failed = routeWaveformDrawing(undefined, 1e-9, box, { error: 'native timeout' })
  assertRouteVisual(failed, 'simulation', 'waveform-visual-failed')
  assert.ok(failed.texts!.some((text) => text.color === '#dc2626' && text.text.includes('native timeout')))
  assert.equal(failed.lines!.filter((line) => line.label === 'A').length, 0)
})

test('display reduction keeps a one-sample overshoot and last sample in a long recording', () => {
  const levels = Array(10001).fill(0)
  levels[3456] = 2.5
  levels[3457] = -0.6
  const long = { ...capture, timestampsSeconds: levels.map((_, i) => i * 1e-12), probes: [{ ...capture.probes[0], voltageLevels: levels }] }
  const drawing = routeWaveformDrawing(long, 1e-8, box)
  const line = drawing.lines!.find((line) => line.label === 'A')!
  assert.ok(line.points.length <= 1600)
  const top = line.points.reduce((a, b) => (b.y > a.y ? b : a))
  const lowest = line.points.reduce((a, b) => (b.y < a.y ? b : a))
  assert.ok(Math.abs(top.x - (24 + 0.3456 * 252)) < 0.1, 'narrow overshoot survives downsampling')
  assert.ok(Math.abs(lowest.x - (24 + 0.3457 * 252)) < 0.1, 'narrow undershoot survives downsampling')
  assert.equal(line.points.at(-1)!.x, 276)
})

test('receiver thresholds come from the bound IBIS model of each undriven input', () => {
  const ibis = '[Model] rx_in\nModel_type Input\nVinl = 800mV\nVinh=2.0\n[Model] tx_out\nModel_type Output\nVinl=0.1\n'
  const model = {
    metadata: {
      sourceSha256: sha256(ibis),
      pins: [
        { port: 'rx', model: 'RX_IN', modelType: 'Input' },
        { port: 'tx', model: 'tx_out', modelType: 'Output' },
      ],
    },
  } as unknown as RouteBuffer
  assert.deepEqual(routeReceiverLimits({ 'models/x.ibs': ibis }, [model], []), [
    { voltage: 0.8, label: 'Vinl 0.8 V' },
    { voltage: 2, label: 'Vinh 2 V' },
  ])
  assert.deepEqual(routeReceiverLimits({ 'models/x.ibs': ibis }, [model], ['rx']), [], 'driven ports are not receivers')
  assert.deepEqual(routeReceiverLimits({}, [model], []), [], 'no source, no limits')
})
