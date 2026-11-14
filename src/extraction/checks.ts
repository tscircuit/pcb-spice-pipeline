// Reciprocity and passivity checks for extracted matrices.
import { fail } from './diagnostics'
import { sum, symmetrize, type Matrix } from './linalg'

export interface MatrixCheck { matrix: Matrix; reciprocityResidual: number; cholesky: Matrix }

/** Checks finite square shape and returns max absolute transpose mismatch divided by max absolute entry. */
function reciprocityResidual(a: Matrix, name: string): number {
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
