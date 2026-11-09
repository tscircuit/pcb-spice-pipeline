// Reciprocity / passivity / reference reduction (was matrices.mjs validateMatrix/loopImpedance/referenceCapacitance).
import { fail } from './diagnostics'
import { multiply, sum, symmetrize, transpose, type Matrix } from './linalg'

export interface MatrixCheck { matrix: Matrix; reciprocityResidual: number; cholesky: Matrix }
export interface CapacitanceCheck { matrix: Matrix; reciprocityResidual: number; convention: string; positiveEnergy: string }

/** Checks finite square shape and returns max absolute transpose mismatch divided by max absolute entry. */
export function reciprocityResidual(a: Matrix, name: string): number {
  if (!a.length || a.some(r => r.length !== a.length || r.some(v => !Number.isFinite(v)))) fail('matrix_format', `${name}: finite square matrix required`)
  const norm = Math.max(...a.flat().map(Math.abs))
  if (!norm) fail('matrix_zero', name)
  return Math.max(...a.flatMap((r, i) => r.map((v, j) => Math.abs(v - a[j][i])))) / norm
}

/** Rejects a matrix that is not finite, square, reciprocal within tolerance and positive definite; returns its symmetric part and Cholesky factor as proof. */
export function validateMatrix(a: Matrix, name: string, tolerance: number = 0.02): MatrixCheck {
  const n=a.length
  const residual=reciprocityResidual(a,name)
  const norm=Math.max(...a.flat().map(Math.abs))
  if (residual>tolerance) fail('reciprocity', `${name}: residual ${residual} > ${tolerance}`)
  const m=symmetrize(a)
  const l: Matrix=m.map(() => Array(n).fill(0))
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++) {
    const v=m[i][j]-sum(l[i].slice(0,j).map((x,k)=>x*l[j][k]))
    if(i===j) {
      if(v<=norm*1e-12) fail('passivity', `${name}: nonpositive Cholesky pivot ${v}`)
      l[i][j]=Math.sqrt(v)
    } else l[i][j]=v/l[j][j]
  }
  return {matrix:m,reciprocityResidual:residual,cholesky:l}
}
/** Reduces an (n+1)-conductor impedance matrix to n signal loops that each return through the last conductor. */
export function loopImpedance(a: Matrix): Matrix {
  const n=a.length-1
  if(n < 1) fail('matrix_dimension','At least one signal plus a return required')
  const A=Array.from({length:n+1},(_,i)=>Array.from({length:n},(_,j)=>i===n?-1:Number(i===j)))
  return multiply(multiply(transpose(A),a),A)
}
/** Checks grounded Maxwell signs, reciprocity and positive quadratic energy without changing any coefficient. */
export function validateCapacitance(matrix: Matrix, tolerance: number = 0.025): CapacitanceCheck {
  const residual = reciprocityResidual(matrix, 'C signal block')
  if (residual > tolerance) fail('reciprocity', `C signal block: residual ${residual} > ${tolerance}`)
  if (matrix.some((r, i) => r.some((v, j) => i !== j && v > 0) || sum(r) <= 0)) fail('capacitance_sign', 'Grounded Maxwell C needs nonpositive mutual C and positive shunt C')
  // Positive row AND column sums make the symmetric quadratic form strictly
  // diagonally dominant. No averaged matrix or Cholesky of an altered C is used.
  if (transpose(matrix).some(r => sum(r) <= 0)) fail('passivity', 'C signal block needs positive column sums for positive quadratic energy')
  return { matrix, reciprocityResidual: residual, convention: 'Vreturn=0 relative to infinity; C=Cprim[signals,signals]; total charge may be nonzero', positiveEnergy: 'Strict row and column diagonal dominance with Maxwell signs; residual asymmetry retained' }
}

/** Holds the joined physical return (all ground pours and connections) at zero and selects only signal excitations and charges. */
export function referenceCapacitance(c: Matrix, tolerance: number = 0.025): CapacitanceCheck {
  if (c.length < 2) fail('matrix_dimension', 'At least one signal plus a return required')
  return validateCapacitance(c.slice(0, -1).map(row => row.slice(0, -1)), tolerance)
}

/** Floating finite-return, zero-total-current reduction for a primitive Maxwell conductance matrix. */
export function referenceConductance(g: Matrix): Matrix {
  const rows = g.map(sum)
  const denominator = sum(rows)
  if (denominator === 0 && rows.every(value => value === 0)) return g.slice(0, -1).map(row => row.slice(0, -1))
  if (!(denominator > 0)) fail('reference', 'G requires positive common conductance or zero row sums')
  return g.slice(0, -1).map((row, i) => row.slice(0, -1).map((value, j) => value - rows[i] * rows[j] / denominator))
}
