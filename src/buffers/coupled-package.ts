import type { IbisComponent } from '@tscircuit/ibis-to-spice'
import { parsePackageModel } from './package-model'
import { selectPackageModel, type SelectedPackageModel } from './package-matrix'

/** Resolve and validate every mapped physical pin, including its explicit reference balls. */
export function coupledPackage(text: string, component: IbisComponent, pins: string[]): SelectedPackageModel | undefined {
  return component.coupledPackage === undefined ? undefined : selectPackageModel(parsePackageModel(text, component.coupledPackage), pins)
}

/** Report exact [Pin] self-term differences without substituting scalar package values. */
export function packageComparisons(component: IbisComponent, selected: SelectedPackageModel): string[] {
  return selected.pins.flatMap((pin, i) => (['resistance', 'inductance', 'capacitance'] as const).flatMap((field, j) => {
    const scalar = component.pins[pin]?.[field]
    const matrix = [selected.selfTerms.R, selected.selfTerms.L, selected.selfTerms.C][j][i]
    return scalar !== undefined && scalar !== matrix ? [`${pin}: [Pin] ${field} ${scalar}; [Package Model] self term ${matrix} (matrix takes precedence before unused-pin reduction)`] : []
  }))
}

/**
 * Board-to-die currents define the signs of R and mutual L. Self resistors plus
 * CCVS terms realize the entire R matrix; signed K realizes L. Maxwell C is split
 * equally at board/die ends as one lumped pi section, relative to ideal die ground.
 */
export function coupledPackageElements(data: Pick<SelectedPackageModel, 'pins' | 'R' | 'L' | 'C'>, terminals: string[], die: string[], ground: string): string[] {
  const elements: string[] = []
  for (let i = 0; i < terminals.length; i++) {
    let node = `PKGS${i}`
    elements.push(`VPKGS${i} ${terminals[i]} ${node} 0`)
    if (data.R[i][i] > 0) {
      elements.push(`RPKG${i} ${node} PKGR${i} ${data.R[i][i]}`)
      node = `PKGR${i}`
    }
    for (let j = 0; j < terminals.length; j++) if (i !== j && data.R[i][j] !== 0) {
      const next = `PKGR${i}_${j}`
      elements.push(`HPKG${i}_${j} ${node} ${next} VPKGS${j} ${data.R[i][j]}`)
      node = next
    }
    elements.push(`LPKG${i} ${node} ${die[i]} ${data.L[i][i]}`)
    const reference = data.C[i].reduce((sum, value) => sum + value, 0)
    if (reference > 0) elements.push(`CPKG${i}a ${terminals[i]} ${ground} ${reference / 2}`, `CPKG${i}b ${die[i]} ${ground} ${reference / 2}`)
    for (let j = i + 1; j < terminals.length; j++) {
      const coupling = data.L[i][j] / Math.sqrt(data.L[i][i] * data.L[j][j])
      if (coupling !== 0) elements.push(`KPKG${i}_${j} LPKG${i} LPKG${j} ${coupling}`)
      const capacitance = -data.C[i][j] / 2
      if (capacitance > 0) elements.push(`CPKG${i}_${j}a ${terminals[i]} ${terminals[j]} ${capacitance}`, `CPKG${i}_${j}b ${die[i]} ${die[j]} ${capacitance}`)
    }
  }
  return elements
}
