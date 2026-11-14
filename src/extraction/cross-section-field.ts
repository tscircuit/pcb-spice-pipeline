import { sectionKernel } from './cross-section-kernel'
import { sectionPanels } from './cross-section-mesh'
import { sectionFactor, sectionReciprocity } from './cross-section-matrix'
import { sectionEpsilon0, type SectionRegion } from './cross-section-types'
import { fail } from './diagnostics'
import { symmetrize, type Matrix } from './linalg'

/** Solve potential and dielectric-transmission equations; differentiate the SAME field operator
 * for material loss. This is the electrostatic energy sensitivity, not an averaged loss tangent.
 */
export function sectionField(region: SectionRegion, count: number, extent: number, vacuum: boolean): { C: Matrix; loss: Matrix; panels: number; residual: number } {
  const panels = sectionPanels(region, count, extent, vacuum)
  const size = region.conductors.length
  const rhs = panels.map(panel => Array.from({ length: size }, (_, j) => Number(panel.group === j)))
  const fields: Float64Array[] = []
  const matrix = panels.map((a, i) => {
    const values = Float64Array.from(panels, b => sectionKernel(a, b, region.height))
    if (a.group < 0) {
      fields[i] = values.slice()
      for (let j = 0; j < panels.length; j++) values[j] = Number(i === j) - a.contrast * a.length * values[j]
    }
    return values
  })
  const solve = sectionFactor(matrix)
  const charge = solve(rhs)
  const hasLoss = region.dielectrics.some(layer => layer.lossTangent > 0) && !vacuum
  const derivative = hasLoss ? panels.map((a, i) => Array.from({ length: size }, (_, j) => a.group < 0 ? a.derivative * a.length * charge.reduce((sum, row, k) => sum + fields[i][k] * row[j], 0) : 0)) : rhs.map(row => row.map(() => 0))
  const lossCharge = hasLoss ? solve(derivative) : derivative
  const C: Matrix = Array.from({ length: size }, () => Array(size).fill(0))
  const loss = C.map(row => [...row])
  for (const [k, panel] of panels.entries()) if (panel.group >= 0) for (let j = 0; j < size; j++) {
    C[panel.group][j] += sectionEpsilon0 * panel.er * charge[k][j]
    loss[panel.group][j] += sectionEpsilon0 * panel.er * (lossCharge[k][j] + panel.tangent * charge[k][j])
  }
  const residual = Math.max(sectionReciprocity(C), sectionReciprocity(loss))
  if (!Number.isFinite(residual) || residual > .015) fail('reciprocity', `Cross-section raw reciprocity ${residual}; refine panels or interface extent`)
  return { C: symmetrize(C), loss: symmetrize(loss), panels: panels.length, residual }
}
