import test from 'node:test'
import assert from 'node:assert/strict'
import { receiverThreshold, routeWaveformDrawing, roundTicks } from '../../src/simulation'
import type { RoutedCapture } from '../../src/simulation'

type RouteBuffer = Parameters<typeof receiverThreshold>[1][number]
import { sha256 } from '../../src/kernel'
import { assertRouteVisual, routedVisualFixture } from '../support/routed-visual-fixture'

// Synthetic drawing data only: irregular sampling and a negative undershoot.
const capture: RoutedCapture = {
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

test('waveform pane: one colour per probe, near ends dashed underneath, a threshold band and noise-free round ticks', () => {
  const original = structuredClone(capture)
  const drawing = routeWaveformDrawing({ probes, capture, durationSeconds: 1e-9, threshold: { low: 0.8, high: 2 }, running: false })
  assertRouteVisual(drawing, 'simulation', 'waveform-visual')
  assert.deepEqual(capture, original, 'pure drawing never mutates results')
  const curves = drawing.lines!.filter((line) => line.layer === 'waveform')
  assert.deepEqual(curves.map((line) => [line.label, Boolean(line.strokeDash)]), [['VICTIM', true], ['DATA', false]])
  assert.ok(drawing.lines!.some((line) => line.label === 'receiver threshold' && line.zIndex === -0.5))
  assert.ok(drawing.texts!.every((text) => !/e-\d/.test(text.text)), 'no floating-point noise in labels')
  assert.deepEqual(roundTicks(-0.55, 0.2, 5).map((tick) => tick.text), ['-0.4', '-0.2', '0.0', '0.2'])
})

test('pending, running and failed captures draw empty axes, an amber hatch and a red reason, never invented curves', () => {
  assertRouteVisual(routeWaveformDrawing({ probes, durationSeconds: 1e-9, running: false }), 'simulation', 'waveform-visual-pending')
  const running = routeWaveformDrawing({ probes, durationSeconds: 1e-9, running: true })
  assert.ok(running.lines!.filter((line) => line.strokeColor === 'rgba(251, 191, 36, 0.3)').length > 5)
  const failed = routeWaveformDrawing({ probes, durationSeconds: 1e-9, running: false, error: 'native timeout' })
  assertRouteVisual(failed, 'simulation', 'waveform-visual-failed')
  assert.ok(failed.texts!.some((text) => text.text.includes('native timeout')))
  assert.equal(failed.lines!.filter((line) => line.label === 'DATA').length, 0)
})

test('a long capture folds into a two-UI eye at the channel bit period; above six probes an envelope keeps one worst curve', async () => {
  const { root } = await routedVisualFixture()
  const board = root.stageOutput('RouteSectionsSolver').value[0]
  const ports = root.stageOutput('RouteBindingsSolver').value[0].mappings.map((mapping) => mapping.to)
  const times = Array.from({ length: 4001 }, (_, i) => i * 25e-12)
  const square = times.map((time) => (Math.floor(time / 2.5e-9) % 2) * 3.3)
  const eye = routeWaveformDrawing({ board, probes: [{ name: 'P', sourcePortId: ports[0], near: false }], capture: { ...capture, timestampsSeconds: times, probes: [{ name: 'P', sourcePortId: ports[0], voltageLevels: square }] }, durationSeconds: 100e-9, running: false })
  assert.ok(eye.texts!.some((text) => text.text === '2 UI'))
  assert.ok(eye.lines!.filter((line) => line.layer === 'waveform').length > 10, 'one run per fold')
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `N${i}`, sourcePortId: `n${i}`, voltageLevels: capture.probes[0].voltageLevels.map((value) => value + i * 0.01 + (i === 5 ? 1 : 0)) }))
  const envelope = routeWaveformDrawing({ probes: many.map((probe) => ({ ...probe, near: false })), capture: { ...capture, probes: many }, durationSeconds: 1e-9, running: false })
  assert.ok(envelope.lines!.some((line) => line.zIndex === -0.4))
  assert.deepEqual([...new Set(envelope.lines!.flatMap((line) => (line.layer === 'waveform' ? [line.label] : [])))], ['N5'])
})

test('receiver thresholds come from the bound IBIS models of single-ended receivers only', () => {
  const text = '[Model] RX_IN\nModel_type Input\nVinl = 0.8V\nVinh = 2000m\n[End]\n'
  /** A bound receiver model of the given IBIS type. */
  const model = (modelType: string): RouteBuffer => ({ name: 'U', source: '', spicePinMapping: {}, warnings: [], sourceEvidence: [], metadata: { sourceSha256: sha256(text), pins: [{ port: 'rx', model: 'RX_IN', modelType }] } }) as unknown as RouteBuffer
  assert.deepEqual(receiverThreshold({ 'models/x.ibs': text }, [model('Input')], new Set(['rx'])), { low: 0.8, high: 2 })
  assert.equal(receiverThreshold({ 'models/x.ibs': text }, [model('Input_diff')], new Set(['rx'])), undefined)
  assert.equal(receiverThreshold({ 'models/x.ibs': text }, [model('Input')], new Set(['other'])), undefined)
})
