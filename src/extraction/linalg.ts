import { numerics } from '../kernel'
import { fail } from './diagnostics'
// Dense real matrices (was matrices.mjs sum/scale/transpose/multiply/symmetrize).
export type Matrix = number[][]
/** Adds up a list of numbers (0 for an empty list). */
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
/** Multiplies every entry of a matrix by one factor, e.g. to split a stage into equal sections. */
export const scale = (a: Matrix, k: number): Matrix => a.map(r => r.map(v => v * k))
/** Swaps rows and columns of a matrix. */
export const transpose = (a: Matrix): Matrix => a[0].map((_, j) => a.map(r => r[j]))
/** Ordinary matrix product a·b. */
export const multiply = (a: Matrix, b: Matrix): Matrix => a.map(r => transpose(b).map(c => sum(r.map((v, k) => v * c[k]))))
/** Averages a matrix with its transpose, removing the small asymmetry solvers leave behind. */
export const symmetrize = (a: Matrix): Matrix => a.map((r, i) => r.map((v, j) => (v + a[j][i]) / 2))

/** Pivoted dense elimination with multiple right-hand sides; never truncates a lane matrix. */
export function solve(matrix: Matrix, rhs: Matrix): Matrix {
  const n = matrix.length
  const m = rhs[0].length
  const a = matrix.map((row, i) => Float64Array.from([...row, ...rhs[i]]))
  for (let k = 0; k < n; k++) {
    let pivot = k
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i
    if (!Number.isFinite(a[pivot][k]) || Math.abs(a[pivot][k]) < numerics.pivotAbsoluteFloor) fail('matrix_singular', `Singular field matrix at pivot ${k}`)
    const row = a[k]
    a[k] = a[pivot]
    a[pivot] = row
    for (let i = k + 1; i < n; i++) {
      const factor = a[i][k] / a[k][k]
      for (let j = k + 1; j < n + m; j++) a[i][j] -= factor * a[k][j]
    }
  }
  const x = Array.from({ length: n }, () => Array(m).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = 0; j < m; j++) {
    let v = a[i][n + j]
    for (let k = i + 1; k < n; k++) v -= a[i][k] * x[k][j]
    x[i][j] = v / a[i][i]
  }
  return x
}
