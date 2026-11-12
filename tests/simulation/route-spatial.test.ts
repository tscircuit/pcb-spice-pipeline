import test from 'node:test'
import assert from 'node:assert/strict'
import type { RouteSpatialWaveform } from '../../src/simulation'

test('spatial capture transports board coordinates and point-major voltages as JSON', () => {
  const waveform: RouteSpatialWaveform = { points: [{ node: 'route1', net: 'DATA', layer: 'top', x: -4, y: .35 }], timeSeconds: [0, 1e-9], volts: [[0, 3.3]] }
  assert.deepEqual(JSON.parse(JSON.stringify(waveform)), waveform)
})

import { routeSpatialPoints, routeSpatialWaveform, compactRouteVectors } from '../../src/simulation/route-spatial'
import type { RouteSpatialPoint } from '../../src/simulation'
import { formatSpiceVectors, parseSpiceVectors, spiceProbeRows } from '../../src/observation'

/** Ordered board-space nodes, with an interior probe deliberately off the even sampling grid. */
function route(net: string, length: number): RouteSpatialPoint[] {
  return Array.from({ length }, (_, i) => ({ node: `${net}${i}`, net, layer: 'top', x: i, y: net === 'DATA' ? 0 : .35 }))
}

test('caps the union at 2,000 unique nodes, shares route samples and always retains probes and ends', () => {
  const data = route('DATA', 6000)
  const victim = route('VICTIM', 3000)
  const points = routeSpatialPoints([data, [data.at(-1)!, ...victim]], ['DATA123', 'VICTIM987'])
  assert.equal(points.length, 2000)
  assert.equal(new Set(points.map(point => point.node)).size, points.length)
  for (const node of ['DATA0', 'DATA5999', 'VICTIM0', 'VICTIM2999', 'DATA123', 'VICTIM987']) assert.ok(points.some(point => point.node === node))
  const selected = points.filter(point => point.net === 'DATA')
  assert.ok(selected.length > 1300 && selected.length < 1350)
  assert.ok(selected.every((point, i) => !i || point.x > selected[i - 1].x))
  assert.ok(Math.max(...selected.slice(1).map((point, i) => point.x - selected[i].x)) <= 6)
  assert.deepEqual(routeSpatialPoints([data.slice(0, 2), [data[1], { ...data[0], node: '0' }]], []), data.slice(0, 2))
  assert.throws(() => routeSpatialPoints([data], data.map(point => point.node)), /exceed/)
  assert.deepEqual(routeSpatialPoints([], []), [])
})

test('spatial vectors share at most 1,000 actual times, preserve end samples and leave full differential probes unchanged', () => {
  const times = Array.from({ length: 4001 }, (_, i) => (i / 4000) ** 2 * 1e-9)
  const positive = times.map(time => time * 3e9)
  const negative = times.map(time => time * 1e9)
  const vectors = parseSpiceVectors(formatSpiceVectors([
    { name: 'v(n)', type: 'voltage', values: negative },
    { name: 'time', type: 'time', values: times },
    { name: 'v(p)', type: 'voltage', values: positive },
  ]))
  const original = structuredClone(vectors)
  const points = [{ ...route('DATA', 1)[0], node: 'P' }, { ...route('DATA', 1)[0], node: 'n', x: 8 }]
  const spatial = routeSpatialWaveform(points, vectors)
  assert.equal(spatial.timeSeconds.length, 1000)
  assert.equal(spatial.timeSeconds[0], 0)
  assert.equal(spatial.timeSeconds.at(-1), 1e-9)
  assert.equal(spatial.volts.length, 2)
  for (const [i, time] of spatial.timeSeconds.entries()) {
    const sample = times.indexOf(time)
    assert.equal(spatial.volts[0][i], positive[sample])
    assert.equal(spatial.volts[1][i], negative[sample])
  }
  const probe = spiceProbeRows(vectors, [{ signalNode: 'p', referenceNode: 'n' }])
  assert.equal(probe.length, times.length)
  assert.deepEqual(probe, spiceProbeRows(formatSpiceVectors(vectors), [{ signalNode: 'p', referenceNode: 'n' }]))
  assert.deepEqual(vectors, original)
})

test('duplicate breakpoints keep the last sample; missing and incomplete spatial vectors fail', () => {
  const points = route('DATA', 1)
  const vectors = [{ name: 'time', type: 'time', values: [0, 1, 1, 2] }, { name: 'v(DATA0)', type: 'voltage', values: [0, 1, 2, 3] }]
  assert.deepEqual(routeSpatialWaveform(points, vectors), { points, timeSeconds: [0, 1, 2], volts: [[0, 2, 3]] })
  assert.throws(() => routeSpatialWaveform(points, vectors.slice(0, 1)), /Missing/)
  assert.throws(() => routeSpatialWaveform(points, [{ ...vectors[0], values: [1, 0] }, vectors[1]]), /increasing/)
  assert.throws(() => routeSpatialWaveform(points, [vectors[0], { ...vectors[1], values: [0, 1] }]), /Incomplete/)
})


test('short HTTP captures preserve every probe sample while discarding branch currents and decimating spatial ASCII', () => {
  const times = Array.from({ length: 4001 }, (_, i) => i * 1e-12)
  const raw = formatSpiceVectors([
    { name: 'time', type: 'time', values: times },
    { name: 'v(probe)', type: 'voltage', values: times.map(time => time * 1e9) },
    { name: 'v(route)', type: 'voltage', values: times.map(time => time * 2e9) },
    { name: 'i(branch)', type: 'current', values: times.map(() => 1) },
  ])
  assert.deepEqual(compactRouteVectors('old deck', raw), { 'waveform.raw': raw })
  const files = compactRouteVectors('* Routed probe nodes: PROBE\n', raw)
  const probes = [{ signalNode: 'probe', referenceNode: '0' }]
  assert.deepEqual(spiceProbeRows(files['waveform.raw'], probes), spiceProbeRows(raw, probes))
  assert.deepEqual(parseSpiceVectors(files['waveform.raw']).map(vector => vector.name), ['time', 'v(probe)'])
  const spatial = parseSpiceVectors(files['spatial.raw'])
  assert.equal(spatial[0].values.length, 1000)
  assert.equal(spatial[0].values.at(-1), times.at(-1))
  assert.deepEqual(spatial.map(vector => vector.name), ['time', 'v(probe)', 'v(route)'])
  assert.match(files['native-waveform.sha256'], /^[a-f0-9]{64}$/)
  assert.ok(files['spatial.raw'].length < raw.length)
})


test('browser min/max grid retains narrow signed peaks, edge brackets and differential extrema within 5,000 samples', () => {
  const times = Array.from({ length: 20001 }, (_, i) => i * 1e-12)
  const step: number[] = times.map((_, i) => i < 6743 || i >= 15432 ? 0 : 3.3)
  step[12345] = 4.5
  step[12346] = -.7
  const positive = times.map((_, i) => i * .001)
  const negative = [...positive]
  negative[13678] -= .0001 // Both legs remain monotone; only the differential probe has an interior peak.
  const vectors = [
    { name: 'time', type: 'time', values: times },
    { name: 'v(step)', type: 'voltage', values: step },
    { name: 'v(p)', type: 'voltage', values: positive },
    { name: 'v(n)', type: 'voltage', values: negative },
  ]
  const original = structuredClone(vectors)
  const raw = formatSpiceVectors(vectors)
  const files = compactRouteVectors('* Routed probe nodes: step p n\n* Routed probe pairs: step,0 p,n p,0 n,0\n', raw)
  const probes = [{ signalNode: 'step', referenceNode: '0' }, { signalNode: 'p', referenceNode: 'n' }]
  const full = spiceProbeRows(raw, probes)
  const browser = spiceProbeRows(files['waveform.raw'], probes)
  assert.equal(browser.length, 5000)
  assert.deepEqual(browser[0], full[0])
  assert.deepEqual(browser.at(-1), full.at(-1))
  assert.ok(browser.every((row, i) => !i || row[0] > browser[i - 1][0]))
  assert.ok(browser.every(row => times.includes(row[0])))
  for (const column of [1, 2]) {
    assert.equal(browser.reduce((value, row) => Math.min(value, row[column]), Infinity), full.reduce((value, row) => Math.min(value, row[column]), Infinity))
    assert.equal(browser.reduce((value, row) => Math.max(value, row[column]), -Infinity), full.reduce((value, row) => Math.max(value, row[column]), -Infinity))
  }
  for (const index of [6742, 6743, 12345, 12346, 13678, 15431, 15432]) assert.ok(browser.some(row => row[0] === times[index]), `edge/peak at ${index}`)
  assert.equal(parseSpiceVectors(files['spatial.raw'])[0].values.length, 1000)
  assert.deepEqual(vectors, original)
  assert.equal(spiceProbeRows(raw, probes).length, times.length, 'native source remains full resolution')
})
