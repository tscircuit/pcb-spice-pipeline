import type { RouteEnergy } from './route-energy'

/** Measured size of one truncated inverse-inductance realization. */
export interface SusceptanceStats {
  cells: number
  components: number
  largestComponent: number
  inductancePairs: number
  inversePairs: number
  keptPairs: number
}

/** Stable SPICE precision, matching the coupled-inductor realization. */
const number = (value: number): string => Number(value.toPrecision(12)).toString()

/** Lower Cholesky factor of a dense symmetric block, or undefined when the block is not positive definite. */
export function choleskyFactor(matrix: number[][]): number[][] | undefined {
  const size = matrix.length
  const factor = matrix.map(() => new Array<number>(size).fill(0))
  for (let i = 0; i < size; i++) for (let j = 0; j <= i; j++) {
    let value = matrix[i][j]
    for (let k = 0; k < j; k++) value -= factor[i][k] * factor[j][k]
    if (i !== j) factor[i][j] = value / factor[j][j]
    else if (value > 0) factor[i][i] = Math.sqrt(value)
    else return undefined
  }
  return factor
}

/** Symmetric inverse of a positive definite block through its Cholesky factor. */
function inverse(matrix: number[][], factor: number[][]): number[][] {
  const size = matrix.length
  const result = matrix.map(() => new Array<number>(size).fill(0))
  for (let column = 0; column < size; column++) {
    const forward = new Array<number>(size).fill(0)
    for (let i = 0; i < size; i++) {
      let value = i === column ? 1 : 0
      for (let k = 0; k < i; k++) value -= factor[i][k] * forward[k]
      forward[i] = value / factor[i][i]
    }
    for (let i = size - 1; i >= 0; i--) {
      let value = forward[i]
      for (let k = i + 1; k < size; k++) value -= factor[k][i] * result[k][column]
      result[i][column] = value / factor[i][i]
    }
  }
  return result.map((row, i) => row.map((value, j) => (value + result[j][i]) / 2))
}

/**
 * Realize a coupled series inductance matrix by its truncated inverse K = L⁻¹ (susceptance) instead of K lines.
 * Each coupled cell gets a flux node f: a capacitor L(i,i) integrates the cell voltage, so f = flux / L(i,i), and
 * the cell current is a sparse sum of K(i,j) L(j,j) f(j). Off-diagonal terms with |K(i,j)| <= threshold * sqrt(K(i,i) K(j,j))
 * are dropped; every truncated block must stay positive definite, which keeps the stored energy ½ fluxᵀ K flux passive.
 * Cells left without a coupling become one plain inductor of 1/K(i,i).
 */
export function susceptanceEnergy(lines: string[], tag: string, before: string[], after: string[], matrix: RouteEnergy, threshold: number): SusceptanceStats {
  if (!(threshold >= 0 && threshold < 1)) throw new Error('Susceptance threshold must be in [0,1)')
  const active = before.map((node, i) => node !== after[i])
  /** The coupled-inductor realization ignores the same negligible mutual terms. */
  const coupled = (i: number, j: number, value: number): boolean => i !== j && active[j] && Math.abs(value) > 1e-24
  const component = before.map(() => -1)
  const stats: SusceptanceStats = { cells: 0, components: 0, largestComponent: 0, inductancePairs: 0, inversePairs: 0, keptPairs: 0 }
  for (let seed = 0; seed < before.length; seed++) {
    if (!active[seed] || component[seed] >= 0) continue
    const cells = [seed]
    component[seed] = stats.components
    for (let next = 0; next < cells.length; next++) for (const [j, value] of matrix.rows[cells[next]]) {
      if (coupled(cells[next], j, value) && component[j] < 0) {
        component[j] = stats.components
        cells.push(j)
      }
    }
    stats.components++
    stats.cells += cells.length
    stats.largestComponent = Math.max(stats.largestComponent, cells.length)
    if (cells.length > 2000) throw new Error(`${tag}: susceptance component of ${cells.length} cells exceeds the 2000-cell dense bound`)
    const block = cells.map(i => cells.map(j => matrix.rows[i].get(j) ?? 0))
    stats.inductancePairs += cells.reduce((total, i) => total + matrix.entries(i).filter(([j, value]) => j > i && coupled(i, j, value)).length, 0)
    const factor = choleskyFactor(block)
    if (!factor) throw new Error(`${tag}: series inductance block is not positive definite`)
    const exact = inverse(block, factor)
    const kept = exact.map((row, i) => row.map((value, j) => i === j || Math.abs(value) > threshold * Math.sqrt(exact[i][i] * exact[j][j]) ? value : 0))
    stats.inversePairs += exact.reduce((total, row, i) => total + row.filter((value, j) => j > i && value !== 0).length, 0)
    stats.keptPairs += kept.reduce((total, row, i) => total + row.filter((value, j) => j > i && value !== 0).length, 0)
    if (!choleskyFactor(kept)) throw new Error(`${tag}: truncated susceptance block is not positive definite`)
    for (const [a, i] of cells.entries()) {
      const terms = kept[a].flatMap((value, b) => value !== 0 && b !== a ? [b] : [])
      if (!terms.length) {
        lines.push(`L${tag}${i} ${before[i]} ${after[i]} ${number(1 / kept[a][a])}`)
        continue
      }
      const flux = `${tag}f${i}`
      lines.push(`C${tag}F${i} ${flux} 0 ${number(block[a][a])}`, `G${tag}F${i} 0 ${flux} ${before[i]} ${after[i]} 1`)
      for (const b of [a, ...terms]) lines.push(`G${tag}_${i}_${cells[b]} ${before[i]} ${after[i]} ${tag}f${cells[b]} 0 ${number(kept[a][b] * block[b][b])}`)
    }
  }
  return stats
}
