import test from 'node:test'
import assert from 'node:assert/strict'
import type { SolverRequest } from '../../../src/solver'

test('worker surfaces engine diagnostics through the error protocol', async () => {
  const original = globalThis.postMessage
  const handler = globalThis.onmessage
  const messages: unknown[] = []
  globalThis.postMessage = (message: unknown): void => {
    messages.push(message)
  }
  try {
    await import('../../../src/adapters/browser/spice-worker')
    const receive = globalThis.onmessage as unknown as (event: MessageEvent<SolverRequest>) => Promise<void>
    await receive(new MessageEvent('message', { data: { solver: 'ngspice', args: [], outputFiles: [], files: { 'simulation.cir': 'invalid' } } }))
    assert.equal(messages.length, 1)
    assert.match(JSON.stringify(messages[0]), /Expected a declarative routed/)
  } finally { globalThis.postMessage = original
    globalThis.onmessage = handler }
})
