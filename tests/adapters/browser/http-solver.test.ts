import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpSolver } from '../../../src/adapters/browser'
import type { SolverRequest } from '../../../src/solver'

const request: SolverRequest = {
  solver: 'ngspice',
  files: { 'simulation.cir': 'deck' },
  args: ['-n', '-b', '-r', 'waveform.raw', 'simulation.cir'],
  outputFiles: ['waveform.raw'],
}
const result = { stdout: 'out', stderr: '', files: { 'waveform.raw': 'raw samples' } }

test('posts the solver protocol to the local backend and forwards cancellation', async () => {
  const controller = new AbortController()
  const run = createHttpSolver({
    signal: controller.signal,
    fetch: async (url, options) => {
      assert.equal(url, '/api/run-solver')
      assert.equal(options?.method, 'POST')
      assert.deepEqual(options?.headers, { 'Content-Type': 'application/json' })
      assert.deepEqual(JSON.parse(options?.body as string), request)
      assert.equal(options?.signal, controller.signal)
      return Response.json(result)
    },
  })
  assert.deepEqual(await run(request), result)
})

test('backend failures retain diagnostics and native timeout codes', async () => {
  for (const [status, code] of [
    [502, 'native_solver'],
    [504, 'native_timeout'],
  ] as const) {
    await assert.rejects(
      createHttpSolver({ fetch: async () => Response.json({ error: 'ngspice rejected deck' }, { status }) })(request),
      { code, message: `${code}: ngspice rejected deck` },
    )
  }
})

test('rejects incomplete, malformed and unsuccessful results', async () => {
  for (const value of [
    null,
    {},
    { ...result, exitCode: 1 },
    { ...result, files: [] },
    { ...result, files: { 'waveform.raw': 2 } },
    { ...result, files: {} },
  ]) {
    await assert.rejects(createHttpSolver({ fetch: async () => Response.json(value) })(request), {
      code: 'native_solver',
    })
  }
})

test('network and abort failures propagate to the async solver stage', async () => {
  await assert.rejects(
    createHttpSolver({
      fetch: async () => {
        throw new DOMException('Cancelled', 'AbortError')
      },
    })(request),
    { name: 'AbortError' },
  )
})
