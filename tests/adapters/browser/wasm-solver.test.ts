import test from 'node:test'
import assert from 'node:assert/strict'
import { createWasmSolver, type SpiceWorker } from '../../../src/adapters/browser'
import { routedRequest } from '../../../src/simulation/route-transient'

/** Deterministic worker port; deliberately never executes SPICE. */
class WorkerFixture implements SpiceWorker {
  onmessage: SpiceWorker['onmessage'] = null
  onerror: SpiceWorker['onerror'] = null
  onmessageerror: SpiceWorker['onmessageerror'] = null
  terminated = 0
  request?: unknown
  /** Capture the exact engine request. */
  postMessage(message: unknown): void { this.request = message }
  /** Count disposal on every exit path. */
  terminate(): void { this.terminated++ }
  /** Deliver a structured worker response. */
  reply(data: unknown): void { this.onmessage?.({ data } as MessageEvent) }
}
const request = routedRequest({ deck: 'title\n.save v(n)\n.tran 1e-11 1e-9\n.end\n' })

test('watchdog terminates a hung worker, including engine initialization', async () => {
  const worker = new WorkerFixture()
  const run = createWasmSolver({ timeoutMs: 10, createWorker: () => worker })
  await assert.rejects(run(request), { code: 'native_timeout' })
  assert.equal(worker.terminated, 1)
  assert.equal(worker.onmessage, null)
})

test('success forwards progress and terminates the worker without a later timeout', async () => {
  const worker = new WorkerFixture()
  const progress: string[] = []
  const run = createWasmSolver({ timeoutMs: 20, createWorker: () => worker, progress: message => progress.push(message) })
  const pending = run(request)
  worker.reply({ kind: 'progress', message: 'Running transient' })
  const result = { stdout: '', stderr: '', files: { 'waveform.raw': 'vectors' } }
  worker.reply({ kind: 'result', result })
  assert.deepEqual(await pending, result)
  assert.deepEqual(worker.request, request)
  assert.deepEqual(progress, ['Running transient'])
  await new Promise<void>(resolve => setTimeout(resolve, 30))
  assert.equal(worker.terminated, 1)
})

for (const kind of ['engine', 'worker', 'message', 'invalid', 'cancel', 'post'] as const) test(`${kind} failure rejects and disposes the worker`, async () => {
  const worker = new WorkerFixture()
  const controller = new AbortController()
  if (kind === 'post') worker.postMessage = (): never => {
    throw new Error('post failed')
  }
  const pending = createWasmSolver({ timeoutMs: 100, signal: controller.signal, createWorker: () => worker })(request)
  if (kind === 'engine') worker.reply({ kind: 'error', error: 'timestep too small' })
  if (kind === 'worker') worker.onerror?.({ message: 'startup failed' } as ErrorEvent)
  if (kind === 'message') worker.onmessageerror?.({} as MessageEvent)
  if (kind === 'invalid') worker.reply({})
  if (kind === 'cancel') controller.abort()
  await assert.rejects(pending)
  assert.equal(worker.terminated, 1)
})

test('unsupported protocols and cancelled input never create a worker', async () => {
  let workers = 0
  /** Count worker construction to enforce admission before spending resources. */
  const createWorker = (): SpiceWorker => {
    workers++
    return new WorkerFixture() }
  assert.throws(() => createWasmSolver({ timeoutMs: 0 }), { code: 'native_timeout' })
  const run = createWasmSolver({ createWorker })
  await assert.rejects(run({ ...request, solver: 'fasthenry' }), { code: 'native_solver' })
  await assert.rejects(run({ ...request, files: { ...request.files, 'extra.lib': 'x' } }), /self-contained/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(createWasmSolver({ createWorker, signal: controller.signal })(request), /cancelled/)
  assert.equal(workers, 0)
})
