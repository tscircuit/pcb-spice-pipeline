import { runSpiceEngine } from './spice-engine'
import type { SolverRequest } from '../../solver'

/** One worker has one run; the host always terminates it after receiving the result. */
globalThis.onmessage = async ({ data }: MessageEvent<SolverRequest>): Promise<void> => {
  try {
    const result = await runSpiceEngine(data.files['simulation.cir'], message => globalThis.postMessage({ kind: 'progress', message }))
    globalThis.postMessage({ kind: 'result', result })
  } catch (error) { globalThis.postMessage({ kind: 'error', error: String(error) }) }
}
