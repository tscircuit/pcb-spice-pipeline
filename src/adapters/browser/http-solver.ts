import type { RunSolver, SolverResult } from '../../solver'
import { fail } from '../diagnostics'

export interface HttpSolverOptions {
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

/** Run the existing solver protocol against the same-origin, local-only Vite backend. */
export function createHttpSolver({ fetch = globalThis.fetch, signal }: HttpSolverOptions = {}): RunSolver {
  return async (request) => {
    const response = await fetch('/api/run-solver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
    const result = (await response.json()) as SolverResult & { error?: string }
    if (!response.ok)
      fail(
        response.status === 504 ? 'native_timeout' : 'native_solver',
        result?.error ?? `Local backend returned HTTP ${response.status}`,
      )
    if (
      !result ||
      typeof result.stdout !== 'string' ||
      typeof result.stderr !== 'string' ||
      !result.files ||
      typeof result.files !== 'object' ||
      Array.isArray(result.files) ||
      Object.values(result.files).some((body) => typeof body !== 'string') ||
      (result.exitCode !== undefined && result.exitCode !== 0)
    )
      fail('native_solver', 'Invalid local backend solver result')
    for (const path of request.outputFiles)
      if (!Object.hasOwn(result.files, path)) fail('native_solver', `Local backend omitted ${path}`)
    return result
  }
}
