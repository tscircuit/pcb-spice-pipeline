import test from 'node:test'
import assert from 'node:assert/strict'
import { waveformConvergence } from '../../src/observation'

test('a narrow NEXT/FEXT peak cannot pass because its RMS is small or another probe is quiet high', () => {
  const before = [[0, 3.3, 0], [.499999, 3.3, 0], [.5, 3.3, .01], [.500001, 3.3, 0], [1, 3.3, 0]]
  const after = before.map((row, i) => i === 2 ? [row[0], 3.3, .02] : row)
  const result = waveformConvergence(before, after, 0, [3.3, 0])
  assert.equal(result.accepted, false)
  assert.ok(result.probes[1].rms_v < .001)
  assert.equal(result.probes[1].peak_change_v, .01)
  assert.equal(waveformConvergence(after, after, 0, [3.3, 0]).accepted, true)
})
