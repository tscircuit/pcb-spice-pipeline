import test from 'node:test'
import assert from 'node:assert/strict'
import { probeWaveformRows } from '../../src/observation'

test('waveforms reject malformed samples and backwards time; duplicate breakpoints retain the final sample', () => {
  assert.throws(() => probeWaveformRows('time a\n0 NaN\n', [1]), { code: 'waveform' })
  assert.throws(() => probeWaveformRows('time a\n1 0\n0 1\n', [1]), { code: 'waveform' })
  assert.deepEqual(probeWaveformRows('time a\n0 0\n1 1\n1 2\n2 3\n', [1]), [[0, 0], [1, 2], [2, 3]])
})
