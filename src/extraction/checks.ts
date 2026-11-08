// Reciprocity / passivity / reference reduction (was matrices.mjs validateMatrix/loopImpedance/referenceCapacitance).
import { numerics } from '../kernel'
import { fail } from './diagnostics'
import { sum, symmetrize, maxAbs, type Matrix } from './linalg'

/** Measures antisymmetry before any averaging, without hiding a discretization error. */
export function reciprocityResidual(matrix: Matrix): number {
  const norm = maxAbs(matrix)
  return norm ? matrix.reduce((largest,row,i)=>row.reduce((current,v,j)=>Math.max(current,Math.abs(v-matrix[j][i])),largest),0)/norm : 0
}

export interface MatrixCheck { matrix: Matrix; reciprocityResidual: number; cholesky: Matrix }

/** Rejects a matrix that is not finite, square, reciprocal within tolerance and positive definite; returns its symmetric part and Cholesky factor as proof. */
export function validateMatrix(a: Matrix, name: string, tolerance: number = numerics.matrixReciprocity): MatrixCheck {
  const n=a.length
  if (!n || a.some(r => r.length!==n || r.some(v => !Number.isFinite(v)))) fail('matrix_format', `${name}: finite square matrix required`)
  const norm=maxAbs(a)
  if (!norm) fail('matrix_zero',name)
  const residual=reciprocityResidual(a)
  if (residual>tolerance) fail('reciprocity', `${name}: residual ${residual} > ${tolerance}`)
  const m=symmetrize(a)
  const l: Matrix=m.map(() => Array(n).fill(0))
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++) {
    const v=m[i][j]-sum(l[i].slice(0,j).map((x,k)=>x*l[j][k]))
    if(i===j) {
      if(v<=norm*numerics.choleskyRelativeFloor) fail('passivity', `${name}: nonpositive Cholesky pivot ${v}`)
      l[i][j]=Math.sqrt(v)
    } else l[i][j]=v/l[j][j]
  }
  return {matrix:m,reciprocityResidual:residual,cholesky:l}
}
