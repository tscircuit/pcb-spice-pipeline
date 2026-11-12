import test from 'node:test'
import assert from 'node:assert/strict'
import { runSpiceEngine } from '../../../src/adapters/browser/spice-engine'

test('engine admission rejects interactive or missing transient decks before initialization', async () => {
  for (const deck of ['title\n.end', 'title\n.tran 1e-9 -1\n.end', 'title\n.control\n.endc\n.tran 1e-11 1e-9\n.end']) await assert.rejects(runSpiceEngine(deck), { code: 'native_solver' })
})
