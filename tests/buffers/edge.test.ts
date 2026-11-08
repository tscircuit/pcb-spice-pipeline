import test from 'node:test'
import assert from 'node:assert/strict'
import { extractionBand } from '../../src/buffers'
test('missing bit timing has a named diagnostic rather than a guessed band', () => {
  assert.throws(() => extractionBand([],[]),{code:'ibis_edge'})
})
