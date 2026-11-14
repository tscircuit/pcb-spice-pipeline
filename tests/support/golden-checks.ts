// Shared helpers for the golden known-answer checks (docs/golden-checks.md). They only measure;
// every expected value and tolerance lives beside its check, with its source.
import { accessSync, constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { TestContext } from 'node:test'
import { createNativeSolver } from '../../src/adapters'

/** Local vendor IBIS bytes are never committed: skip cleanly unless IBIS_MODEL_DIR holds `file`. */
export async function vendorText(context: TestContext, file: string): Promise<string | undefined> {
  if (!process.env.IBIS_MODEL_DIR) {
    context.skip(`Set IBIS_MODEL_DIR to local vendor ${file}; vendor bytes are not committed`)
    return
  }
  try {
    return await readFile(join(process.env.IBIS_MODEL_DIR, file), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    context.skip(`Local vendor ${file} is unavailable`)
    return
  }
}

/**
 * Eigenvalues of a real symmetric matrix, ascending, by cyclic Jacobi rotations
 * (Golub & Van Loan, Matrix Computations, 4th ed., §8.5.2). Independent of production linear algebra.
 */
export function symmetricEigenvalues(matrix: number[][]): number[] {
  const n = matrix.length
  const a = matrix.map(row => [...row])
  const scale = Math.max(...a.flat().map(Math.abs)) || 1
  for (let sweep = 0; sweep < 60; sweep++) {
    let largest = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) largest = Math.max(largest, Math.abs(a[p][q]))
    if (largest <= 1e-15 * scale) break
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) <= 1e-300) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < n; k++) {
        const kp = a[k][p]
        const kq = a[k][q]
        a[k][p] = c * kp - s * kq
        a[k][q] = s * kp + c * kq
      }
      for (let k = 0; k < n; k++) {
        const pk = a[p][k]
        const qk = a[q][k]
        a[p][k] = c * pk - s * qk
        a[q][k] = s * pk + c * qk
      }
    }
  }
  return a.map((row, i) => row[i]).sort((x, y) => x - y)
}

/** Measured energy-matrix facts: asymmetry, extreme eigenvalues and the strongest pairwise coupling. */
export interface EnergyFacts { asymmetry: number; minimumEigenvalue: number; maximumEigenvalue: number; coupling: number; pair: [number, number] }

/** Relative asymmetry, eigenvalue range and max |M_ij|/sqrt(M_ii M_jj) of a square matrix. */
export function energyFacts(matrix: number[][]): EnergyFacts {
  const scale = Math.max(...matrix.flat().map(Math.abs)) || 1
  let asymmetry = 0
  let coupling = 0
  let pair: [number, number] = [0, 0]
  for (let i = 0; i < matrix.length; i++) for (let j = 0; j < matrix.length; j++) {
    asymmetry = Math.max(asymmetry, Math.abs(matrix[i][j] - matrix[j][i]) / scale)
    if (i === j || !(matrix[i][i] > 0 && matrix[j][j] > 0)) continue
    const k = Math.abs(matrix[i][j]) / Math.sqrt(matrix[i][i] * matrix[j][j])
    if (k > coupling) {
      coupling = k
      pair = [i, j]
    }
  }
  const values = symmetricEigenvalues(matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2)))
  return { asymmetry, minimumEigenvalue: values[0], maximumEigenvalue: values.at(-1)!, coupling, pair }
}

/** Maxwell (grounded) capacitance sign facts: smallest diagonal, largest off-diagonal and smallest row sum relative to its diagonal. */
export function maxwellFacts(matrix: number[][]): { minimumDiagonal: number; maximumOffDiagonal: number; minimumRowSum: number } {
  let minimumDiagonal = Infinity
  let maximumOffDiagonal = -Infinity
  let minimumRowSum = Infinity
  for (const [i, row] of matrix.entries()) {
    minimumDiagonal = Math.min(minimumDiagonal, row[i])
    for (const [j, value] of row.entries()) if (i !== j) maximumOffDiagonal = Math.max(maximumOffDiagonal, value)
    minimumRowSum = Math.min(minimumRowSum, row.reduce((sum, value) => sum + value, 0) / row[i])
  }
  return { minimumDiagonal, maximumOffDiagonal: matrix.length > 1 ? maximumOffDiagonal : 0, minimumRowSum }
}

/** True only when an ngspice executable is on PATH; native golden checks skip cleanly otherwise. */
export function ngspiceAvailable(): boolean {
  return (process.env.PATH ?? '').split(delimiter).some(directory => {
    try {
      accessSync(join(directory, 'ngspice'), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Run one small deck through the repo's sequential native adapter (OMP_NUM_THREADS=1) and return
 * its `wrdata golden.dat ...` rows: time (or sweep) first, then each saved vector.
 */
export async function runGoldenDeck(deck: string): Promise<number[][]> {
  const run = createNativeSolver({ timeoutMs: 120_000 })
  const output = await run({ solver: 'ngspice', files: { 'golden.cir': deck }, args: ['-n', '-b', 'golden.cir'], outputFiles: ['golden.dat'] })
  const diagnostic = (output.stdout + '\n' + output.stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
  if (diagnostic) throw new Error(`ngspice: ${diagnostic}`)
  const text = output.files['golden.dat']
  if (!text) throw new Error('ngspice wrote no golden.dat')
  return text.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number))
}

/** Linear interpolation of column `column` at `time` over ascending time rows. */
export function valueAt(rows: number[][], column: number, time: number): number {
  if (time <= rows[0][0]) return rows[0][column]
  for (let i = 1; i < rows.length; i++) if (rows[i][0] >= time) {
    const span = rows[i][0] - rows[i - 1][0]
    return span ? rows[i - 1][column] + (rows[i][column] - rows[i - 1][column]) * (time - rows[i - 1][0]) / span : rows[i][column]
  }
  return rows.at(-1)![column]
}

/** First time after `after` at which column `column` crosses `level` (linear interpolation), or NaN. */
export function crossingTime(rows: number[][], column: number, level: number, after: number = -Infinity): number {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] <= after) continue
    const a = rows[i - 1][column] - level
    const b = rows[i][column] - level
    if (a === 0) return rows[i - 1][0]
    if (a * b < 0 || b === 0) return rows[i - 1][0] + (rows[i][0] - rows[i - 1][0]) * a / (a - b)
  }
  return NaN
}
