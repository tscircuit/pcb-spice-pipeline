import type { CrossSection } from '../board'
import { numerics } from '../kernel'
import { solveCrossSection, type BemResult } from './bem'

const solutions = new Map<string, BemResult>()
/** Reuses only identical physical geometry; clones isolate callers and replays every convergence step. No eviction cap. */
export function cachedSlice(hash: string, slice: CrossSection, progress: (message: string) => void): BemResult {
  const cached = solutions.get(hash)
  if (cached) {
    for (const step of cached.steps) progress(`2D BEM: ${step.panels} panels; entry-wise residual ${step.residual ?? 'initial'}; target < ${numerics.meshRelativeChange}`)
    return structuredClone(cached)
  }
  const solved = solveCrossSection(slice, progress)
  solutions.set(hash, structuredClone(solved))
  return solved
}
