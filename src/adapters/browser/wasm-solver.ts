import type { RunSolver, SolverResult } from '../../solver'
import { fail } from '../diagnostics'

/** Minimal worker port also implemented by the deterministic watchdog test fixture. */
export interface SpiceWorker {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}
export interface WasmSolverOptions {
  timeoutMs?: number
  progress?: (message: string) => void
  signal?: AbortSignal
  createWorker?: () => SpiceWorker
}

/** Run each request in an isolated worker, with a host watchdog covering startup and simulation. */
export function createWasmSolver({ timeoutMs = 900_000, progress = (): void => undefined, signal, createWorker = (): SpiceWorker => new Worker(new URL('./spice-worker.ts', import.meta.url), { type: 'module' }) }: WasmSolverOptions = {}): RunSolver {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail('native_timeout', 'timeoutMs must be a positive integer')
  return async request => {
    if (request.solver !== 'ngspice' || Object.keys(request.files).length !== 1 || typeof request.files['simulation.cir'] !== 'string' || JSON.stringify(request.args) !== JSON.stringify(['-n', '-b', '-r', 'waveform.raw', 'simulation.cir']) || JSON.stringify(request.outputFiles) !== JSON.stringify(['waveform.raw']))
      fail('native_solver', 'WASM requires a self-contained routed ngspice transient request')
    if (signal?.aborted) fail('native_solver', 'WASM ngspice cancelled')
    return new Promise<SolverResult>((resolve, reject) => {
      const worker = createWorker()
      const started = performance.now()
      /** Release timers, listeners and engine memory on success, failure, timeout and cancellation. */
      const finish = (error?: Error, result?: SolverResult): void => {
        clearTimeout(watchdog)
        clearInterval(heartbeat)
        signal?.removeEventListener('abort', abort)
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
        if (error) reject(error)
        else resolve(result!)
      }
      /** Preserve the module diagnostic code while rejecting the asynchronous request. */
      const failure = (code: 'native_solver' | 'native_timeout', detail: string): void => {
        try {
          fail(code, detail)
        }
        catch (error) { finish(error as Error) }
      }
      /** Cancel an obsolete debugger run without leaving its worker consuming CPU. */
      const abort = (): void => failure('native_solver', 'WASM ngspice cancelled')
      const watchdog = setTimeout(() => failure('native_timeout', `WASM ngspice exceeded ${timeoutMs} ms; worker terminated`), timeoutMs)
      const heartbeat = setInterval(() => progress(`ngspice running: ${Math.round((performance.now() - started) / 1000)} s elapsed (limit ${Math.round(timeoutMs / 1000)} s)`), 1000)
      signal?.addEventListener('abort', abort, { once: true })
      worker.onerror = event => failure('native_solver', `WASM worker: ${event.message}`)
      worker.onmessageerror = () => failure('native_solver', 'WASM worker returned an unreadable message')
      worker.onmessage = ({ data }) => {
        if (data?.kind === 'progress') progress(String(data.message))
        else if (data?.kind === 'result') finish(undefined, data.result)
        else failure('native_solver', String(data?.error ?? 'Invalid WASM worker response'))
      }
      try {
        worker.postMessage(request)
      }
      catch (error) { finish(error as Error) }
    })
  }
}
