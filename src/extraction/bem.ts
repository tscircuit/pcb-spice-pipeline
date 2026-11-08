import { numerics } from '../kernel'
import type { CrossSection } from '../board'
import { fail } from './diagnostics'
import { solve, symmetrize, type Matrix } from './linalg'

export const epsilon0 = numerics.epsilon0
export const mu0 = numerics.mu0
interface Point { x: number; z: number }
interface Panel extends Point { tx: number; tz: number; nx: number; nz: number; length: number; group: number; er: number; contrast: number; sigma: number }
export interface BemResult { C: Matrix; C0: Matrix; loss: Matrix; surface: Matrix; steps: { panels: number; residual: number | null; rawResidual: number | null }[] }
/** Permittivity on the indicated side of a boundary. Coordinates are millimetres. */
function material(slice: CrossSection, x: number, z: number): number {
  return slice.dielectrics.find(d => x > d.xMin && x < d.xMax && z > d.zMin && z < d.zMax)?.er ?? 1
}
/** Analytic antiderivative of log distance, including the self-panel limit. */
function primitive(x: number, y: number): number {
  return x * Math.log(Math.hypot(x, y) || 1) - x + (y ? Math.abs(y) * Math.atan(x / Math.abs(y)) : 0)
}
/** Exact constant-panel single-layer potential and normal-field kernels. */
function pointKernel(a: Panel, b: Panel): [number, number] {
  const dx = a.x - b.x
  const dz = a.z - b.z
  const u = dx * b.tx + dz * b.tz
  const v = -dx * b.tz + dz * b.tx
  const h = b.length / 2
  const potential = -(primitive(u + h, v) - primitive(u - h, v)) / (2 * Math.PI * b.length)
  if (a === b) return [potential, 0]
  const tangent = Math.log(Math.hypot(u + h, v) / Math.hypot(u - h, v)) / b.length
  const normal = Math.abs(v) < 1e-14 ? 0 : Math.sign(v) * (Math.atan((u + h) / Math.abs(v)) - Math.atan((u - h) / Math.abs(v))) / b.length
  return [potential, (a.nx * (b.tx * tangent - b.tz * normal) + a.nz * (b.tz * tangent + b.tx * normal)) / (2 * Math.PI)]
}
/** Galerkin target-panel averaging; exact self potential removes collocation's first-order self error. */
function kernel(a: Panel, b: Panel): [number, number] {
  if (a === b) return [(-Math.log(a.length) + 1.5) / (2 * Math.PI), 0]
  const result: [number, number] = [0, 0]
  for (const [t, weight] of numerics.panelQuadrature) {
    const sample = { ...a, x: a.x + t * a.tx * a.length / 2, z: a.z + t * a.tz * a.length / 2 }
    const k = pointKernel(sample, b)
    result[0] += k[0] * weight / 2
    result[1] += k[1] * weight / 2
  }
  return result
}
/** Cosine grading resolves edge singularities; breakpoints resolve metal and layer scales. */
function panels(slice: CrossSection, count: number, vacuum: boolean): Panel[] {
  const result: Panel[] = []
  /** Algebraic grading concentrates panels at physical metal/dielectric corners. */
  const grade = (i: number): number => i ** numerics.edgeGradingPower / (i ** numerics.edgeGradingPower + (count - i) ** numerics.edgeGradingPower)
  /** Adds a directed boundary, interior on the left. */
  const edge = (a: Point, b: Point, group: number, er: number, contrast: number, sigma: number): void => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-12) return
    const cuts = [0, 1]
    if (Math.abs(dz) < 1e-12) for (const c of slice.conductors) for (const x of [c.xMin, c.xMax, (c.xMin + c.xMax) / 2]) {
      const t = (x - a.x) / dx
      if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t)
    }
    const ordered = [...new Set(cuts)].sort((x, y) => x - y)
    for (let k = 1; k < ordered.length; k++) for (let i = 0; i < count; i++) {
      const lo = ordered[k - 1] + (ordered[k] - ordered[k - 1]) * grade(i)
      const hi = ordered[k - 1] + (ordered[k] - ordered[k - 1]) * grade(i + 1)
      const x = a.x + dx * (lo + hi) / 2
      const z = a.z + dz * (lo + hi) / 2
      const nx = dz / length
      const nz = -dx / length
      const adjacent = vacuum ? 1 : material(slice, x + nx * numerics.interfaceProbeMm, z + nz * numerics.interfaceProbeMm)
      result.push({ x, z, tx: dx / length, tz: dz / length, nx, nz, length: length * (hi - lo), group,
        er: group >= -1 ? adjacent : er, contrast, sigma })
    }
  }
  for (const c of slice.conductors) {
    const corners = [{ x: c.xMin, z: c.zMin }, { x: c.xMax, z: c.zMin }, { x: c.xMax, z: c.zMax }, { x: c.xMin, z: c.zMax }]
    for (let i = 0; i < 4; i++) edge(corners[i], corners[(i + 1) % 4], c.group, 1, 0, c.conductivitySm)
  }
  if (!vacuum) for (const d of slice.dielectrics) {
    const corners = [{ x: d.xMin, z: d.zMin }, { x: d.xMax, z: d.zMin }, { x: d.xMax, z: d.zMax }, { x: d.xMin, z: d.zMax }]
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 4]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length = Math.hypot(dx, dz)
      const cuts = [0, 1]
      for (const c of [...slice.conductors, ...slice.dielectrics]) for (const t of Math.abs(dz) < 1e-12 ? [(c.xMin - a.x) / dx, (c.xMax - a.x) / dx] : [(c.zMin - a.z) / dz, (c.zMax - a.z) / dz]) if (t > 0 && t < 1) cuts.push(t)
      const sorted = [...new Set(cuts)].sort((x, y) => x - y)
      for (let k = 1; k < sorted.length; k++) {
        const lo = sorted[k - 1]
        const hi = sorted[k]
        const x = a.x + dx * (lo + hi) / 2
        const z = a.z + dz * (lo + hi) / 2
        if (slice.conductors.some(c => x > c.xMin - numerics.boundaryToleranceMm && x < c.xMax + numerics.boundaryToleranceMm && z > c.zMin - numerics.boundaryToleranceMm && z < c.zMax + numerics.boundaryToleranceMm)) continue
        const outside = material(slice, x + dz / length * numerics.interfaceProbeMm, z - dx / length * numerics.interfaceProbeMm)
        if (outside === d.er || (outside !== 1 && d.er < outside)) continue // each shared interface once
        edge({ x: a.x + dx * lo, z: a.z + dz * lo }, { x: a.x + dx * hi, z: a.z + dz * hi }, -2, d.er, (d.er - outside) / (d.er + outside), 0)
      }
    }
  }
  return result
}
/** Neutral 2D single-layer BEM with dielectric transmission boundaries and a free common potential. */
function capacitance(slice: CrossSection, count: number, vacuum: boolean): { C: Matrix; panels: Panel[]; charge: Matrix } {
  const p = panels(slice, count, vacuum)
  const n = p.length
  const groups = Math.max(...slice.conductors.map(c => c.group)) + 1
  const a: Matrix = p.map((target, i) => [...p.map((source, j) => {
    const [potential, field] = kernel(target, source)
    return target.group >= -1 ? potential : (i === j ? 1 / target.length : 0) - 2 * target.contrast * field
  }), target.group >= -1 ? 1 : 0])
  a.push([...p.map(() => 1), 0])
  const rhs: Matrix = p.map(panel => Array.from({ length: groups }, (_, j) => Number(panel.group === j)))
  rhs.push(Array(groups).fill(0))
  const charge = solve(a, rhs).slice(0, n)
  const C: Matrix = Array.from({ length: groups }, (_, i) => Array.from({ length: groups }, (_, j) => p.reduce((s, panel, k) => s + (panel.group === i ? epsilon0 * panel.er * charge[k][j] : 0), 0)))
  return { C, panels: p, charge }
}
/** Eliminates floating, neutral conductors without silently grounding them. */
function reduceCapacitance(c: Matrix, active: number): Matrix {
  if (active === c.length) return c
  const coupling = c.slice(active).map(row => row.slice(0, active))
  const inverse = solve(c.slice(active).map(row => row.slice(active)), coupling)
  return c.slice(0, active).map((row, i) => row.slice(0, active).map((v, j) => v - row.slice(active).reduce((s, q, k) => s + q * inverse[k][j], 0)))
}
/** Entry-wise relative convergence, with only a roundoff floor for exact symmetry zeros. */
export function matrixResidual(a: Matrix, b: Matrix): number {
  const scale = Math.max(...b.flat().map(Math.abs))
  return Math.max(...b.flatMap((row, i) => row.map((v, j) => Math.abs(v - a[i][j]) / Math.max(Math.abs(v), scale * numerics.symmetryZeroRelative))))
}
/** Refines without a step/attempt cap; no native 3D process is invoked. */
export function solveCrossSection(slice: CrossSection, progress: (message: string) => void = () => {}): BemResult {
  if (slice.conductors.some(c => ![c.xMin, c.xMax, c.zMin, c.zMax, c.conductivitySm].every(Number.isFinite))) fail('mesh_convergence', 'Finite physical cross-section coordinates and conductivity are required')
  let count = numerics.initialPanelsPerEdge as number
  let previous: { C: Matrix; C0: Matrix } | undefined
  let previousEstimate: { C: Matrix; C0: Matrix } | undefined
  const steps: BemResult['steps'] = []
  for (;;) {
    const normal = capacitance(slice, count, false)
    const vacuum = capacitance(slice, count, true)
    const active = slice.activeCount ?? normal.C.length
    const reduced = reduceCapacitance(normal.C, active)
    const reducedVacuum = reduceCapacitance(vacuum.C, active)
    const rawResidual = previous ? Math.max(matrixResidual(previous.C, reduced), matrixResidual(previous.C0, reducedVacuum)) : null
    const ratio = numerics.meshRefinementRatio ** numerics.capacitanceExtrapolationOrder
    const estimate = previous ? {
      C: reduced.map((row, i) => row.map((v, j) => (ratio * v - previous!.C[i][j]) / (ratio - 1))),
      C0: reducedVacuum.map((row, i) => row.map((v, j) => (ratio * v - previous!.C0[i][j]) / (ratio - 1))),
    } : undefined
    const residual = estimate && previousEstimate ? Math.max(matrixResidual(previousEstimate.C, estimate.C), matrixResidual(previousEstimate.C0, estimate.C0)) : null
    steps.push({ panels: normal.panels.length, residual, rawResidual })
    progress(`2D BEM: ${normal.panels.length} panels; entry-wise residual ${residual ?? 'initial'}; target < 0.005`)
    if (residual !== null && residual < numerics.meshRelativeChange) {
      const inverse = solve(vacuum.C, vacuum.C.map((_, i) => vacuum.C.map((__, j) => Number(i === j))))
      const currents = vacuum.charge.map(row => inverse[0].map((_, j) => row.reduce((s, q, i) => s + epsilon0 * q * inverse[i][j], 0)))
      const surface = inverse.map((_, i) => inverse.map((__, j) => vacuum.panels.reduce((s, panel, k) => s + currents[k][i] * currents[k][j] / (panel.length / 1000) / Math.sqrt(panel.sigma), 0)))
      let loss: Matrix = reduced.map(row => row.map(() => 0))
      for (let k = 0; k < slice.dielectrics.length; k++) {
        const d = slice.dielectrics[k]
        if (!d.lossTangent) continue
        const shifted = { ...slice, dielectrics: slice.dielectrics.map((v, i) => i === k ? { ...v, er: v.er * (1 + numerics.dielectricRelativeStep) } : v) }
        const high = reduceCapacitance(capacitance(shifted, count, false).C, active)
        loss = loss.map((row, i) => row.map((v, j) => v + d.lossTangent * (high[i][j] - reduced[i][j]) / numerics.dielectricRelativeStep))
      }
      return { C: symmetrize(estimate!.C), C0: symmetrize(estimate!.C0), loss: symmetrize(loss), surface: symmetrize(surface.slice(0, active).map(row => row.slice(0, active))), steps }
    }
    if (!Number.isFinite(residual ?? 0)) fail('mesh_convergence', 'Nonfinite BEM refinement; inspect cross-section geometry')
    previousEstimate = estimate
    previous = { C: reduced, C0: reducedVacuum }
    count *= numerics.meshRefinementRatio
  }
}
