import test from 'node:test'
import assert from 'node:assert/strict'
import { routeWaveformDrawing, roundStep } from '../../src/simulation'
import type { RoutedCapture } from '../../src/simulation'
import { routeTones } from '../../src/board'
import { assertRouteVisual } from '../support/routed-visual-fixture'

// Synthetic drawing data only: exercises irregular sampling and a negative undershoot.
const capture: Extract<RoutedCapture, { kind: 'completed' }> = {
  kind: 'completed',
  qualification: 'candidate-unqualified',
  timestampsSeconds: [0, 0.2e-9, 0.21e-9, 0.25e-9, 1e-9],
  probes: [
    { name: 'DATA', sourcePortId: 'data', voltageLevels: [0, 0.8, 2.1, 1.5, 1.5] },
    { name: 'VICTIM', sourcePortId: 'victim', voltageLevels: [0, 0.1, -0.5, 0.05, 0] },
  ],
}
const probes = [
  { name: 'DATA', sourcePortId: 'data', near: false },
  { name: 'VICTIM', sourcePortId: 'victim', near: true },
]

test('waveform pane: one colour per probe, dashed near ends, round data-range ticks and no fixed limit lines', () => {
  const original = structuredClone(capture)
  const drawing = routeWaveformDrawing(undefined, probes, capture, 1e-9)
  assertRouteVisual(drawing, 'simulation', 'waveform-visual')
  assert.deepEqual(capture, original, 'pure drawing never mutates results')
  const [data, victim] = ['DATA', 'VICTIM'].map((name) => drawing.lines!.find((line) => line.label === name)!)
  assert.notEqual(data.strokeColor, victim.strokeColor)
  assert.ok(victim.strokeDash && !data.strokeDash)
  assert.equal(victim.points.length, capture.timestampsSeconds.length)
  assert.ok(victim.points[1].x < victim.points[2].x)
  assert.deepEqual(drawing.texts!.filter((text) => text.text.endsWith(' V')).map((text) => text.text), ['-1 V', '0 V', '1 V', '2 V', '3 V'])
  assert.ok(drawing.texts!.some((text) => text.text === '1 ns'))
  assert.ok(drawing.texts!.every((text) => !['1.9 V', '-0.4 V'].includes(text.text)), 'no board-specific limits')
})

test('pending and failed results draw empty axes with no invented probe traces', () => {
  assertRouteVisual(routeWaveformDrawing(undefined, probes, undefined, 1e-9), 'simulation', 'waveform-visual-pending')
  const failed = routeWaveformDrawing(undefined, probes, undefined, 1e-9, 'native timeout')
  assertRouteVisual(failed, 'simulation', 'waveform-visual-failed')
  assert.ok(failed.texts!.some((text) => text.color === routeTones.failure && text.text.includes('native timeout')))
  assert.equal(failed.lines!.filter((line) => line.label).length, 0)
})

test('display reduction keeps a one-sample overshoot and the last sample in a long recording', () => {
  const levels = Array(10001).fill(0)
  levels[3456] = 2.5
  levels[3457] = -0.6
  const long = { ...capture, timestampsSeconds: levels.map((_, i) => i * 1e-12), probes: [{ ...capture.probes[0], voltageLevels: levels }] }
  const drawing = routeWaveformDrawing(undefined, probes, long, 1e-8)
  const line = drawing.lines!.find((line) => line.label === 'DATA')!
  assert.ok(line.points.length <= 2400)
  assert.equal(line.points.at(-1)!.x, drawing.texts!.find((text) => text.text === '10 ns')!.x)
  const top = Math.max(...line.points.map((point) => point.y))
  assert.ok(top > drawing.texts!.find((text) => text.text === '2 V')!.y, 'narrow overshoot survives downsampling')
})

test('axis steps are 1, 2 or 5 times a power of ten', () => {
  assert.deepEqual([roundStep(3.1, 4), roundStep(8e-9, 5), roundStep(0.07, 4)].map((step) => Number(step.toPrecision(3))), [1, 2e-9, 0.02])
})
