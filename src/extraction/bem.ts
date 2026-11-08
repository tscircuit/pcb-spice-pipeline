import { numerics, max } from '../kernel'
import type { CrossSection } from '../board'
import { reciprocityResidual } from './checks'
import { fail } from './diagnostics'
import { solve, maxAbs, symmetrize, type Matrix } from './linalg'

export const epsilon0 = numerics.epsilon0
export const mu0 = numerics.mu0
interface Point { x: number; z: number }
interface Panel extends Point { tx: number; tz: number; nx: number; nz: number; length: number; group: number; er: number; contrast: number; sigma: number }
export interface BemResult { C: Matrix; C0: Matrix; loss: Matrix; surface: Matrix; steps: { panels: number; residual: number | null; rawResidual: number | null; entries?: Record<string,number> | null; rawEntries?: Record<string,number> | null }[] }
/** Permittivity on the indicated side of a boundary. Coordinates are millimetres. */
function material(slice: CrossSection, x: number, z: number): number {
  return slice.dielectrics.find(d => x > d.xMin && x < d.xMax && z > d.zMin && z < d.zMax)?.er ?? 1
}
/** Analytic antiderivative of log distance, including the self-panel limit. */
function primitive(x: number, y: number): number {
  return x * Math.log(Math.hypot(x, y) || 1) - x + (y ? Math.abs(y) * Math.atan(x / Math.abs(y)) : 0)
}
/** Analytic source integration and Galerkin target averaging, without per-pair allocations.
 * Metal rows need potential; dielectric-transmission rows need normal field only.
 */
function kernel(a: Panel, b: Panel): number {
  const potential = a.group>=-1
  if (a===b) return potential ? (-Math.log(a.length)+1.5)/(2*Math.PI) : 0
  let result = 0
  for (const [t,weight] of numerics.panelQuadrature) {
    const dx = a.x+t*a.tx*a.length/2-b.x
    const dz = a.z+t*a.tz*a.length/2-b.z
    const u = dx*b.tx+dz*b.tz
    const v = -dx*b.tz+dz*b.tx
    const h = b.length/2
    let value: number
    if (potential) value = -(primitive(u+h,v)-primitive(u-h,v))/(2*Math.PI*b.length)
    else {
      const tangent = Math.log(Math.hypot(u+h,v)/Math.hypot(u-h,v))/b.length
      const normal = Math.abs(v)<numerics.kernelNormalZeroMm ? 0 : Math.sign(v)*(Math.atan((u+h)/Math.abs(v))-Math.atan((u-h)/Math.abs(v)))/b.length
      const along = a.nx*b.tx+a.nz*b.tz
      const across = -a.nx*b.tz+a.nz*b.tx
      value = ((along ? along*tangent : 0)+(across ? across*normal : 0))/(2*Math.PI)
    }
    result += value*weight/2
  }
  return result
}
/** Coalesces repeated projections of one geometric corner, at Circuit JSON topology precision.
 * Nearly coincident optional alignment projections create sub-ULP graded slivers.
 * This changes mesh breakpoints only; it never discards a conductor or changes its boundary.
 */
function breakpoints(cuts: number[], length: number): number[] {
  const sorted = [...cuts].sort((a,b)=>a-b)
  const result: number[] = []
  for (const cut of sorted) {
    if (!result.length || (cut-result.at(-1)!)*length > numerics.endpointToleranceMm) result.push(cut)
    else if (cut===1) result[result.length-1]=1
  }
  return result
}
/** Quartic grading resolves edge singularities; breakpoints resolve metal and layer scales. */
function panels(slice: CrossSection, count: number, vacuum: boolean): Panel[] {
  const result: Panel[] = []
  /** Algebraic grading concentrates panels at physical metal/dielectric corners. */
  const grade = (i: number): number => i ** numerics.edgeGradingPower / (i ** numerics.edgeGradingPower + (count - i) ** numerics.edgeGradingPower)
  /** Adds a directed boundary, interior on the left. */
  const edge = (a: Point, b: Point, group: number, er: number, contrast: number, sigma: number): void => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    if (length < numerics.minimumPanelLengthMm) fail('mesh_convergence','Physical boundary is below the documented coordinate resolution')
    const cuts = [0, 1]
    if (Math.abs(dz) < numerics.minimumPanelLengthMm) for (const c of slice.conductors) for (const x of [c.xMin, c.xMax, (c.xMin + c.xMax) / 2]) {
      const t = (x - a.x) / dx
      if (t > numerics.panelEndFractionTolerance && t < 1 - numerics.panelEndFractionTolerance) cuts.push(t)
    }
    const ordered = breakpoints(cuts,length)
    for (let k = 1; k < ordered.length; k++) for (let i = 0; i < count; i++) {
      const lo = ordered[k - 1] + (ordered[k] - ordered[k - 1]) * grade(i)
      const hi = ordered[k - 1] + (ordered[k] - ordered[k - 1]) * grade(i + 1)
      if (hi===lo) fail('mesh_convergence','Panel refinement exhausted IEEE-double coordinate resolution before convergence')
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
      for (const c of [...slice.conductors, ...slice.dielectrics]) for (const t of Math.abs(dz) < numerics.minimumPanelLengthMm ? [(c.xMin - a.x) / dx, (c.xMax - a.x) / dx] : [(c.zMin - a.z) / dz, (c.zMax - a.z) / dz]) if (t > 0 && t < 1) cuts.push(t)
      const sorted = breakpoints(cuts,length)
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
  const groups = max(slice.conductors.map(c => c.group)) + 1
  const a: Matrix = p.map((target, i) => [...p.map((source, j) => {
    const coefficient = kernel(target,source)
    const value = target.group >= -1 ? coefficient : (i === j ? 1 / target.length : 0) - 2 * target.contrast * coefficient
    if (!Number.isFinite(value)) fail('mesh_convergence',`Nonfinite panel coefficient ${i},${j}: ${JSON.stringify({target,source,coefficient})}`)
    return value
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
  const scale = Math.max(maxAbs(a),maxAbs(b))
  if (!scale) return 0
  return b.reduce((largest,row,i)=>row.reduce((current,v,j)=>Math.max(current,Math.abs(v-a[i][j])/Math.max(Math.abs(v),scale*numerics.symmetryZeroRelative)),largest),0)
}
/** Refines all field-derived RLGC terms without an attempt cap or a 3D solver process. */
export function solveCrossSection(slice: CrossSection, progress: (message: string) => void = () => {}): BemResult {
  if (!slice.conductors.length || !slice.conductors.some(c=>c.group===-1) || !slice.conductors.some(c=>c.group>=0) || slice.conductors.some(c => ![c.xMin,c.xMax,c.zMin,c.zMax,c.conductivitySm].every(Number.isFinite) || c.xMin>=c.xMax || c.zMin>=c.zMax || c.conductivitySm<=0)) fail('mesh_convergence','Finite positive metal cross-sections, conductivity, signal and reference are required')
  if (slice.dielectrics.some(d=>![d.xMin,d.xMax,d.zMin,d.zMax,d.er,d.lossTangent].every(Number.isFinite)||d.xMin>=d.xMax||d.zMin>=d.zMax||d.er<=0||d.lossTangent<0)) fail('mesh_convergence','Dielectric rectangles need finite positive extent/permittivity and nonnegative loss tangent')
  let count = numerics.initialPanelsPerEdge as number
  let previous: {C:Matrix;C0:Matrix;L:Matrix;surface:Matrix;loss:Matrix} | undefined
  let previousEstimate: {C:Matrix;C0:Matrix;L:Matrix;surface:Matrix;loss:Matrix} | undefined
  let previousFirst: {C:Matrix;C0:Matrix;surface:Matrix;loss:Matrix} | undefined
  const steps: BemResult['steps'] = []
  for (;;) {
    const normal = capacitance(slice,count,false)
    const vacuum = capacitance(slice,count,true)
    const active = slice.activeCount ?? normal.C.length
    const C = reduceCapacitance(normal.C,active)
    const C0 = reduceCapacitance(vacuum.C,active)
    const L = solve(C0,C0.map((_,i)=>C0.map((__,j)=>Number(i===j))))
    const inverse = solve(vacuum.C,vacuum.C.map((_,i)=>vacuum.C.map((__,j)=>Number(i===j))))
    const currents = vacuum.charge.map(row=>Array.from({length:active},(_,j)=>row.reduce((sum,q,i)=>sum+epsilon0*q*inverse[i][j],0)))
    const surface = C.map((_,i)=>C.map((__,j)=>vacuum.panels.reduce((sum,panel,k)=>sum+currents[k][i]*currents[k][j]/(panel.length/1000)/Math.sqrt(panel.sigma),0)))
    const tangent = Math.max(0,max(slice.dielectrics.map(d=>d.lossTangent)))
    let loss = C.map(row=>row.map(()=>0))
    if (tangent) {
      // Chain rule combines every material sensitivity in one directional solve.
      const shifted = {...slice,dielectrics:slice.dielectrics.map(d=>({...d,er:d.er*(1+numerics.dielectricRelativeStep*d.lossTangent/tangent)}))}
      const high = reduceCapacitance(capacitance(shifted,count,false).C,active)
      loss = high.map((row,i)=>row.map((v,j)=>tangent*(v-C[i][j])/numerics.dielectricRelativeStep))
    }
    const current = {C,C0,L,surface,loss}
    const rawEntries = previous ? Object.fromEntries(Object.entries(current).map(([key,matrix])=>[key,matrixResidual(previous![key as keyof typeof current],matrix)])) : null
    const rawResidual = rawEntries ? max(Object.values(rawEntries)) : null
    /** Removes the leading Galerkin or convex-wedge integration error at this refinement. */
    const extrapolate = (matrix:Matrix,old:Matrix,order:number): Matrix => {
      const ratio = numerics.meshRefinementRatio**order
      return matrix.map((row,i)=>row.map((v,j)=>(ratio*v-old[i][j])/(ratio-1)))
    }
    const estimate = previous ? {
      C:extrapolate(C,previous.C,numerics.capacitanceExtrapolationOrder),
      C0:extrapolate(C0,previous.C0,numerics.capacitanceExtrapolationOrder),
      surface:extrapolate(surface,previous.surface,numerics.skinExtrapolationOrder),
      loss:extrapolate(loss,previous.loss,numerics.capacitanceExtrapolationOrder),
    } : undefined
    const corrected = estimate && previousFirst ? {
      C:extrapolate(estimate.C,previousFirst.C,numerics.capacitanceCorrectionOrder),
      C0:extrapolate(estimate.C0,previousFirst.C0,numerics.capacitanceCorrectionOrder),
      surface:extrapolate(estimate.surface,previousFirst.surface,numerics.skinCorrectionOrder),
      loss:extrapolate(estimate.loss,previousFirst.loss,numerics.capacitanceCorrectionOrder),
    } : undefined
    const physical = corrected ? { C:symmetrize(corrected.C), C0:symmetrize(corrected.C0), surface:symmetrize(corrected.surface), loss:symmetrize(corrected.loss) } : undefined
    const estimated = physical ? {...physical,L:solve(physical.C0,physical.C0.map((_,i)=>physical.C0.map((__,j)=>Number(i===j))))} : undefined
    const entries = estimated && previousEstimate ? Object.fromEntries(Object.entries(estimated).map(([key,matrix])=>[key,matrixResidual(previousEstimate![key as keyof typeof estimated],matrix)])) : null
    const residual = entries ? max(Object.values(entries)) : null
    steps.push({panels:normal.panels.length,residual,rawResidual,entries,rawEntries})
    progress(`2D BEM: ${normal.panels.length} panels; estimated C/C0/L/skin/loss ${residual??'initial'}; raw ${rawResidual??'initial'}; target < ${numerics.meshRelativeChange}`)
    if (residual!==null && residual<numerics.meshRelativeChange) {
      for (const [name,matrix] of Object.entries(corrected!)) if (reciprocityResidual(matrix)>numerics.matrixReciprocity) fail('reciprocity',`BEM ${name}: unprojected antisymmetry exceeds ${numerics.matrixReciprocity}`)
      return {
      C:estimated!.C,C0:estimated!.C0,surface:estimated!.surface,loss:estimated!.loss,steps,
      }
    }
    if (!Number.isFinite(residual??0) || !Number.isFinite(rawResidual??0)) fail('mesh_convergence','Nonfinite BEM refinement; inspect the cross-section')
    previousFirst = estimate
    previousEstimate = estimated
    previous = current
    count *= numerics.meshRefinementRatio
  }
}
