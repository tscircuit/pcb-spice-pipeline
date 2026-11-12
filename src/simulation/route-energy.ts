/** Sparse energy rows retain only terms integrated from a common physical slice. */
export class RouteEnergy {
  readonly rows: Map<number, number>[]
  /** Share a bound across the five assembled matrices, independent of raw cell count. */
  constructor(size: number, private readonly budget: { entries: number } = { entries: 0 }) {
    this.rows = Array.from({ length: size }, () => new Map())
  }
  /** Preserve integration order exactly; structural zeros consume no storage. */
  add(i: number, j: number, value: number): void {
    if (!value) return
    this.set(i, j, (this.rows[i].get(j) ?? 0) + value)
  }
  /** Replace hybrid terms without changing their floating-point evaluation. */
  set(i: number, j: number, value: number): void {
    const row = this.rows[i]
    if (!row.has(j) && value !== 0 && ++this.budget.entries > 500_000) throw new Error('Route energy exceeds sparse-memory limit of 500000 matrix entries')
    if (value === 0) {
      if (row.delete(j)) this.budget.entries--
    } else row.set(j, value)
  }
  /** Stable column order preserves the dense deck's text and floating-point summation. */
  entries(i: number): [number, number][] { return [...this.rows[i]].sort(([a], [b]) => a - b) }
  /** Temporary scaled matrices share the assembled sparsity, without dense allocation. */
  scaled(scale: number): RouteEnergy {
    const result = new RouteEnergy(this.rows.length)
    for (const [i, row] of this.rows.entries()) for (const [j, value] of row) result.rows[i].set(j, value * scale)
    return result
  }
}

/** Stable SPICE precision, bounded far beyond board tolerances. */
const number = (value: number): string => Number(value.toPrecision(12)).toString()

/** Coupled series matrix: sensor-controlled mutual R or ordinary mutually coupled inductors. */
export function seriesEnergy(lines: string[], tag: string, before: string[], after: string[], matrix: RouteEnergy, kind: 'R' | 'L'): void {
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue
    if (kind === 'R') {
      if (before.length === 1) {
        lines.push(`R${tag}${i} ${before[i]} ${after[i]} ${number((matrix.rows[i].get(i) ?? 0))}`)
        continue
      }
      lines.push(`V${tag}${i} ${before[i]} ${tag}s${i} 0`, `R${tag}${i} ${tag}s${i} ${tag}r${i} ${number((matrix.rows[i].get(i) ?? 0))}`)
      const terms = matrix.entries(i).flatMap(([j, r]) => j === i || before[j] === after[j] || Math.abs(r) < 1e-20 ? [] : [{ r, j }])
      let current = `${tag}r${i}`
      if (!terms.length) lines.push(`V${tag}O${i} ${current} ${after[i]} 0`)
      for (const [k, term] of terms.entries()) {
        const next = k === terms.length - 1 ? after[i] : `${tag}h${i}_${k}`
        lines.push(`H${tag}${i}_${k} ${current} ${next} V${tag}${term.j} ${number(term.r)}`)
        current = next
      }
    } else lines.push(`L${tag}${i} ${before[i]} ${after[i]} ${number((matrix.rows[i].get(i) ?? 0))}`)
  }
  if (kind === 'L') for (let i = 0; i < before.length; i++) for (const [j, mutual] of matrix.entries(i)) {
    if (j <= i) continue
    if (before[i] !== after[i] && before[j] !== after[j] && Math.abs(mutual) > 1e-24) lines.push(`K${tag}${i}_${j} L${tag}${i} L${tag}${j} ${number(mutual / Math.sqrt((matrix.rows[i].get(i) ?? 0) * (matrix.rows[j].get(j) ?? 0)))}`)
  }
}

/** Exact sparse realization for symmetric diagonally dominant energy matrices, including positive mutual entries. */
export function shuntEnergy(lines: string[], tag: string, nodes: string[], matrix: RouteEnergy, rate?: number): void {
  const remainder = matrix.rows.map((row, i) => (row.get(i) ?? 0) - matrix.entries(i).reduce((total, [j, value]) => total + (i === j ? 0 : Math.abs(value)), 0))
  if (remainder.some(value => value < -1e-20)) {
    modalShunt(lines, tag, nodes, matrix, rate)
    return
  }
  const terms: { a: string; b: string; c: number; sum: boolean }[] = nodes.map((node, i) => ({ a: node, b: '0', c: Math.max(0, remainder[i]), sum: false }))
  for (let i = 0; i < nodes.length; i++) for (const [j, value] of matrix.entries(i)) if (j > i && Math.abs(value) > 1e-23) terms.push({ a: nodes[i], b: nodes[j], c: Math.abs(value), sum: value > 0 })
  for (const [i, term] of terms.entries()) {
    if (term.c <= 1e-23 || (!term.sum && term.a === term.b)) continue
    const name = `${tag}S${i}`
    if (term.sum) {
      lines.push(`E${name} ${name}a ${term.a} ${term.b} 0 1`, `V${name} ${name}a ${name}b 0`, `C${name} ${name}b ${rate ? `${name}c` : '0'} ${number(term.c)}`,
        `F${name}b ${term.b} 0 V${name} 1`)
      if (rate) lines.push(`R${name} ${name}c 0 ${number(1 / (rate * term.c))}`)
    } else {
      lines.push(`C${name} ${term.a} ${rate ? `${name}c` : term.b} ${number(term.c)}`)
      if (rate) lines.push(`R${name} ${name}c ${term.b} ${number(1 / (rate * term.c))}`)
    }
  }
}

/** LDL energy factors realize a PSD dielectric-loss matrix even when it is not a Maxwell matrix. */
function modalShunt(lines: string[], tag: string, nodes: string[], matrix: RouteEnergy, rate?: number): void {
  if (nodes.length ** 2 > 500_000) throw new Error('Route energy modal realization exceeds 500000 dense entries')
  const residual = matrix.rows.map((row) => nodes.map((_, j) => row.get(j) ?? 0))
  for (let mode = 0; mode < nodes.length; mode++) {
    const capacitance = residual[mode][mode]
    if (capacitance < -1e-20) throw new Error(`${tag}: negative energy pivot`)
    if (capacitance <= 1e-24) continue
    const weights = residual.map((row, i) => i < mode ? 0 : row[mode] / capacitance)
    const expression = weights.flatMap((weight, i) => nodes[i] === '0' || Math.abs(weight) < 1e-12 ? [] : [`${number(weight)}*v(${nodes[i]})`]).join('+')
    if (expression) {
      const name = `${tag}M${mode}`
      lines.push(`E${name} ${name}a 0 value={${expression}}`, `V${name} ${name}a ${name}b 0`, `C${name} ${name}b ${rate ? `${name}c` : '0'} ${number(capacitance)}`)
      if (rate) lines.push(`R${name} ${name}c 0 ${number(1 / (rate * capacitance))}`)
      for (const [i, weight] of weights.entries()) if (nodes[i] !== '0' && Math.abs(weight) >= 1e-12) lines.push(`F${name}_${i} ${nodes[i]} 0 V${name} ${number(weight)}`)
    }
    for (let i = mode + 1; i < nodes.length; i++) for (let j = mode + 1; j < nodes.length; j++) residual[i][j] -= capacitance * weights[i] * weights[j]
  }
}

