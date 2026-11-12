import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSpiceVectors, parseSpiceVectors, spiceProbeRows } from '../../src/observation'

const vectors = [{ name: 'v(n2)', type: 'voltage', values: [1, 2, 3] }, { name: 'time', type: 'time', values: [0, 1e-9, 2e-9] }, { name: 'v(n1)', type: 'voltage', values: [3, 5, 7] }]

test('ASCII native and engine vector transport preserves ordering, precision and differential probes', () => {
  const raw = formatSpiceVectors(vectors)
  assert.deepEqual(parseSpiceVectors(raw), vectors)
  assert.deepEqual(spiceProbeRows(vectors, [{ signalNode: 'n1', referenceNode: 'n2' }]), spiceProbeRows(raw, [{ signalNode: 'n1', referenceNode: 'n2' }]))
  assert.deepEqual(spiceProbeRows(raw, [{ signalNode: 'N1', referenceNode: 'n2' }, { signalNode: 'n2', referenceNode: '0' }]), [[0, 2, 1], [1e-9, 3, 2], [2e-9, 4, 3]])
})

test('malformed, complex, truncated, duplicate and nonfinite raw vectors are rejected', () => {
  const raw = formatSpiceVectors(vectors)
  for (const text of ['', raw.replace('Flags: real', 'Flags: complex'), raw.replace('No. Points: 3', 'No. Points: 4'), raw.replace('v(n1)', 'v(n2)'), raw.replace('0\t1', '0\tNaN'), raw.replace('0\t1', '7\t1'), raw.replace('2\tv(n1)', '7\tv(n1)')]) assert.throws(() => parseSpiceVectors(text), { code: 'waveform' })
  assert.throws(() => spiceProbeRows(raw, [{ signalNode: 'absent', referenceNode: '0' }]), /Missing ngspice vector/)
  assert.throws(() => spiceProbeRows(raw.replace('time\ttime', 'clock\ttime'), []), /Missing ngspice time/)
  assert.throws(() => formatSpiceVectors([{ ...vectors[0], values: [NaN, 0] }]), /finite/)
})

test('duplicate breakpoints retain the final sample and decreasing timestamps fail', () => {
  const raw = formatSpiceVectors([{ name: 'time', type: 'time', values: [0, 1, 1, 2] }, { name: 'v(n)', type: 'voltage', values: [0, 1, 2, 3] }])
  assert.deepEqual(spiceProbeRows(raw, [{ signalNode: 'n', referenceNode: '0' }]), [[0, 0], [1, 2], [2, 3]])
  assert.throws(() => spiceProbeRows(formatSpiceVectors([{ name: 'time', type: 'time', values: [1, 0] }, { name: 'v(n)', type: 'voltage', values: [0, 0] }]), []), /increasing/)
})
