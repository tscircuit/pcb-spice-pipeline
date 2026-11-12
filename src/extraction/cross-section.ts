import { sectionField } from './cross-section-field'
import { sectionRegions, validateSection } from './cross-section-mesh'
import { sectionInverse, sectionPassive } from './cross-section-matrix'
import { copperConductivity, sectionEpsilon0, sectionMu0, type CrossSection, type CrossSectionOptions, type CrossSectionResult, type SectionRegion } from './cross-section-types'
import { fail } from './diagnostics'
import { symmetrize, type Matrix } from './linalg'

export type { CrossSection, CrossSectionOptions, CrossSectionResult, SectionConductor, SectionPlane, SectionDielectric } from './cross-section-types'

/** High-frequency external inductance from the vacuum Maxwell capacitance. */
function inductance(C0: Matrix): Matrix {
  return symmetrize(sectionInverse(C0).map(row => row.map(value => sectionMu0 * sectionEpsilon0 * value)))
}

/** Recede every conducting wall away from the field, weighted by its surface resistivity.
 * Vacuum is essential: moving a wall must not change the electrical dielectric geometry.
 */
function recede(region: SectionRegion, distance: number): SectionRegion {
  const lower = distance * Math.sqrt(copperConductivity / region.lowerConductivity)
  const upper = distance * Math.sqrt(copperConductivity / region.upperConductivity)
  return { ...region, dielectrics: [], height: region.height ? region.height + lower + upper : 0, conductors: region.conductors.map(c => {
    const shift = distance * Math.sqrt(copperConductivity / (c.conductivitySm ?? copperConductivity))
    return { ...c, widthMm: c.widthMm - 2 * shift, thicknessMm: c.thicknessMm - 2 * shift, zMm: c.zMm + shift + lower }
  }) }
}

/** Cheap quasi-TEM extraction with infinite solid references, layered dielectric/mask boundaries
 * and Wheeler incremental-inductance conductor loss. No native processes or pipeline integration.
 * Default work is fixed; convergence is measured by independently changing the two mesh options.
 */
export function solveCrossSection(section: CrossSection, options: CrossSectionOptions = {}): CrossSectionResult {
  validateSection(section)
  const count = options.panelsPerEdge ?? 12
  const extent = options.interfaceExtent ?? 24
  const fraction = options.recessionFraction ?? .01
  if (!Number.isInteger(count) || count < 6 || !Number.isFinite(extent) || extent < 4 || !Number.isFinite(fraction) || fraction <= 0 || fraction > .1) fail('mesh_convergence', 'Use >=6 panels per edge, interface extent >=4 and recession fraction in (0, .1]')
  const size = section.conductors.length
  /** Zero matrix in input conductor order. */
  const zero = (): Matrix => Array.from({ length: size }, () => Array(size).fill(0))
  const C = zero()
  const C0 = zero()
  const L = zero()
  const dielectricLoss = zero()
  const skinResistance = zero()
  const dcResistance = zero()
  let panels = 0
  let residual = 0
  let recessionMm = Infinity
  for (const { region, indices } of sectionRegions(section)) {
    const vacuum = sectionField(region, count, extent, true)
    const field = sectionField(region, count, extent, false)
    const external = inductance(vacuum.C)
    const gaps = region.conductors.flatMap((a, i) => region.conductors.slice(i + 1).map(b => Math.hypot(Math.max(0, Math.abs(a.xMm - b.xMm) - (a.widthMm + b.widthMm) / 2), Math.max(0, a.zMm - b.zMm - b.thicknessMm, b.zMm - a.zMm - a.thicknessMm))))
    const scale = Math.min(...region.conductors.flatMap(c => [c.widthMm, c.thicknessMm, c.zMm, ...(region.height ? [region.height - c.zMm - c.thicknessMm] : [])]).map(value => value / 2), ...gaps.map(gap => gap / 4))
    const weight = Math.max(1, Math.sqrt(copperConductivity / region.lowerConductivity), Math.sqrt(copperConductivity / region.upperConductivity), ...region.conductors.map(c => Math.sqrt(copperConductivity / (c.conductivitySm ?? copperConductivity))))
    const step = fraction * scale / weight
    const plus = inductance(sectionField(recede(region, step), count, extent, true).C)
    const minus = inductance(sectionField(recede(region, -step), count, extent, true).C)
    for (const [i, ii] of indices.entries()) for (const [j, jj] of indices.entries()) {
      C[ii][jj] = field.C[i][j]
      C0[ii][jj] = vacuum.C[i][j]
      L[ii][jj] = external[i][j]
      dielectricLoss[ii][jj] = field.loss[i][j]
      skinResistance[ii][jj] = (plus[i][j] - minus[i][j]) / (2 * step / 1000) * Math.sqrt(Math.PI * sectionMu0 / copperConductivity) / sectionMu0
    }
    panels += field.panels
    residual = Math.max(residual, field.residual, vacuum.residual)
    recessionMm = Math.min(recessionMm, step)
  }
  for (const matrix of [C, C0, L]) sectionPassive(matrix, true)
  for (const matrix of [dielectricLoss, skinResistance]) sectionPassive(matrix)
  for (const [i, c] of section.conductors.entries()) dcResistance[i][i] = 1e6 / ((c.conductivitySm ?? copperConductivity) * c.widthMm * c.thicknessMm)
  /** A diagonal congruence preserves coupled skin-loss passivity and gives hypot(Rdc, Rskin)
   * on every diagonal. The crossover is an interpolation, not an eddy-current field solution.
   */
  const atFrequency = (frequencyHz: number): { R: Matrix; G: Matrix } => {
    if (!Number.isFinite(frequencyHz) || frequencyHz < 0) fail('model_frequency', 'Finite nonnegative cross-section frequency required')
    const root = Math.sqrt(frequencyHz)
    const weights = dcResistance.map((row, i) => {
      const skin = root * skinResistance[i][i]
      return skin > 0 ? Math.sqrt(skin / (Math.hypot(row[i], skin) + row[i])) : 0
    })
    return {
      R: dcResistance.map((row, i) => row.map((value, j) => value + root * skinResistance[i][j] * weights[i] * weights[j])),
      G: dielectricLoss.map(row => row.map(value => frequencyHz ? 2 * Math.PI * frequencyHz * value : 0)),
    }
  }
  return { conductorIds: section.conductors.map(c => c.id), C, C0, L, dielectricLoss, dcResistance, skinResistance, atFrequency, diagnostics: { panels, reciprocityResidual: residual, recessionMm } }
}
