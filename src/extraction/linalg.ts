// Dense real matrices.
export type Matrix = number[][]
/** Adds up a list of numbers (0 for an empty list). */
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
/** Swaps rows and columns of a matrix. */
export const transpose = (a: Matrix): Matrix => a[0].map((_, j) => a.map(r => r[j]))
/** Ordinary matrix product a·b. */
export const multiply = (a: Matrix, b: Matrix): Matrix => a.map(r => transpose(b).map(c => sum(r.map((v, k) => v * c[k]))))
/** Averages a matrix with its transpose, removing the small asymmetry solvers leave behind. */
export const symmetrize = (a: Matrix): Matrix => a.map((r, i) => r.map((v, j) => (v + a[j][i]) / 2))
