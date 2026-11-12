import test from 'node:test'
import assert from 'node:assert/strict'
import { routeWaveformDrawing } from '../../src/simulation'
import type { RoutedCapture } from '../../src/simulation'
import { assertRouteVisual } from '../support/routed-visual-fixture'

// Synthetic drawing data only: exercises irregular sampling and both limit crossings.
const capture: Extract<RoutedCapture, { kind: 'completed' }> = {
  kind: 'completed',
  qualification: 'candidate-unqualified',
  timestampsSeconds: [0, 0.2e-9, 0.21e-9, 0.25e-9, 1e-9],
  probes: [
    { name: 'DATA', sourcePortId: 'data', voltageLevels: [0, 0.8, 2.1, 1.5, 1.5] },
    { name: 'VICTIM', sourcePortId: 'victim', voltageLevels: [0, 0.1, -0.5, 0.05, 0] },
  ],
}

test('waveform SVG snapshot includes axes, explicit limits, probe key and purple victim', () => {
  const original = structuredClone(capture)
  const drawing = routeWaveformDrawing(capture, 1e-9)
  assertRouteVisual(drawing, 'simulation', 'waveform-visual')
  assert.deepEqual(capture, original, 'pure drawing never mutates results')
  const victim = drawing.lines!.find((line) => line.label === 'VICTIM')!
  assert.equal(victim.strokeColor, '#9333ea')
  assert.equal(victim.points.length, capture.timestampsSeconds.length)
  assert.ok(victim.points[1].x < victim.points[2].x)
  assert.ok(drawing.texts!.some((text) => /Time \(ns\)/.test(text.text)))
  for (const limit of ['1.9 V', '-0.4 V']) assert.ok(drawing.texts!.some((text) => text.text === limit))
  for (const point of drawing.lines!.flatMap((line) => line.points)) assert.ok(point.x >= 0 && point.x <= 300 && point.y >= 108 && point.y <= 181)
})

test('pending and failed results are honest banners with no invented probe traces', () => {
  assertRouteVisual(routeWaveformDrawing(undefined, 1e-9), 'simulation', 'waveform-visual-pending')
  const failed = routeWaveformDrawing(undefined, 1e-9, 'native timeout')
  assertRouteVisual(failed, 'simulation', 'waveform-visual-failed')
  assert.ok(failed.texts!.some((text) => text.color === '#dc2626' && text.text.includes('native timeout')))
  assert.equal(failed.lines!.filter((line) => line.strokeWidth === 0.3).length, 0)
})

test('display reduction keeps a one-sample overshoot and last sample in a long recording', () => {
  const levels = Array(10001).fill(0)
  levels[3456] = 2.5
  levels[3457] = -0.6
  const long = { ...capture, timestampsSeconds: levels.map((_, i) => i * 1e-12), probes: [{ ...capture.probes[0], voltageLevels: levels }] }
  const drawing = routeWaveformDrawing(long, 1e-8)
  const line = drawing.lines!.find((line) => line.label === 'DATA')!
  assert.ok(line.points.length <= 1600)
  assert.equal(line.points.at(-1)!.x, 292)
  const top = Math.max(...line.points.map((point) => point.y))
  const limit = drawing.lines!.find((line) => line.label === '1.9 V')!.points[0].y
  assert.ok(top > limit, 'narrow overshoot survives downsampling')
})
