import type { CrossSection } from '../board'
import { numerics } from '../kernel'
import { solveCrossSection, matrixResidual, type BemResult } from './bem'
import { validateMatrix, reciprocityResidual } from './checks'
import { fail } from './diagnostics'

const solutions = new Map<string, BemResult>()
/** Copies converged solutions for evidence checkpoints; the extraction path itself performs no file I/O. */
export function snapshotSlices(): [string, BemResult][] {
  return structuredClone([...solutions])
}
/** Restores a checkpoint after the caller verifies its solver-source fingerprint. No unconverged entry is accepted. */
export function restoreSlices(entries: [string, BemResult][]): void {
  for (const [hash,result] of entries) {
    const residual = result.steps.at(-1)?.residual
    if (typeof hash!=='string' || typeof residual!=='number' || !Number.isFinite(residual) || residual>=numerics.meshRelativeChange) fail('mesh_convergence','Slice checkpoint lacks a converged entry-wise estimate')
    if (!result.surfaces?.length || result.surfaces.some(f => ![f.thicknessM, f.conductivitySm].every(v => Number.isFinite(v) && v > 0))) fail('loss_fit', 'Slice checkpoint lacks physical finite-thickness surface terms; re-extract')
    for (const [name,matrix] of Object.entries({C:result.C,C0:result.C0,surface:result.surface,loss:result.loss, ...Object.fromEntries(result.surfaces.map((f, i) => [`face${i}`, f.matrix]))})) {
      if (matrix.length!==result.C.length || matrix.some(row=>row.length!==matrix.length || row.some(v=>!Number.isFinite(v)))) fail('matrix_format',`checkpoint ${name}: finite matching square matrix required`)
      if (name==='C' || name==='C0') validateMatrix(matrix,`checkpoint ${name}`,numerics.matrixReciprocity)
      else if (reciprocityResidual(matrix)>numerics.matrixReciprocity) fail('reciprocity',`checkpoint ${name}: nonreciprocal matrix`)
    }
    const total = result.surface.map((row, i) => row.map((_, j) => result.surfaces!.reduce((sum, f) => sum + f.matrix[i][j], 0)))
    if (matrixResidual(total, result.surface) > numerics.meshRelativeChange) fail('loss_fit', 'Slice checkpoint surface terms do not sum to its surface-current matrix')
    solutions.set(hash,structuredClone(result))
  }
}
/** Reuses only identical physical geometry; clones isolate callers and replays every convergence step. No eviction cap. */
export function cachedSlice(hash: string, slice: CrossSection, progress: (message: string) => void): BemResult {
  const cached = solutions.get(hash)
  if (cached) {
    for (const step of cached.steps) progress(`2D BEM: ${step.panels} panels; estimated C/C0/L/skin/loss ${step.residual ?? 'initial'}; raw ${step.rawResidual ?? 'initial'}; target < ${numerics.meshRelativeChange}`)
    return structuredClone(cached)
  }
  const solved = solveCrossSection(slice, progress)
  solutions.set(hash, structuredClone(solved))
  return solved
}
