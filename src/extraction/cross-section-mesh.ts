import { copperConductivity, type CrossSection, type SectionDielectric, type SectionPanel, type SectionRegion } from './cross-section-types'
import { fail } from './diagnostics'

/** Material adjacent to a boundary; non-overlapping slabs leave air elsewhere. */
function material(layers: SectionDielectric[], z: number): { er: number; lossTangent: number } {
  return layers.find(layer => z > layer.zMm && z < layer.zMm + layer.thicknessMm) ?? { er: 1, lossTangent: 0 }
}

/** Merge floating-point copies of one boundary before making panels; never create zero-size seams. */
function coordinates(values: number[], tolerance: number): number[] {
  return values.sort((a, b) => a - b).filter((value, i, sorted) => !i || value - sorted[i - 1] > tolerance)
}

/** Reflect an upper-only reference, and split signals into regions shielded by solid planes. */
export function sectionRegions(section: CrossSection): { region: SectionRegion; indices: number[] }[] {
  const planes = [...section.planes].sort((a, b) => a.zMm - b.zMm)
  const groups = new Map<number, number[]>()
  for (const [i, conductor] of section.conductors.entries()) {
    const key = planes.filter(plane => plane.zMm < conductor.zMm).length
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([key, indices]) => {
    const below = planes[key - 1]
    const above = planes[key]
    const sign = below ? 1 : -1
    const origin = below?.zMm ?? above.zMm
    const lower = below ?? above
    const conductors = indices.map(i => {
      const c = section.conductors[i]
      return { ...c, zMm: sign > 0 ? c.zMm - origin : origin - c.zMm - c.thicknessMm }
    })
    const height = below && above ? above.zMm - below.zMm : 0
    const dielectrics = section.dielectrics.map(layer => {
      const lo = Math.max(0, sign > 0 ? layer.zMm - origin : origin - layer.zMm - layer.thicknessMm)
      const hi = Math.min(height || Infinity, sign > 0 ? layer.zMm + layer.thicknessMm - origin : origin - layer.zMm)
      return { ...layer, zMm: lo, thicknessMm: hi - lo }
    }).filter(layer => layer.thicknessMm > 1e-12)
    return { indices, region: { conductors, dielectrics, height, lowerConductivity: lower.conductivitySm ?? copperConductivity, upperConductivity: above?.conductivitySm ?? copperConductivity } }
  })
}

/** Quartically graded surface panels, split at all material and conductor projection boundaries.
 * Only dielectric interfaces are truncated horizontally; fields and solid planes remain infinite.
 */
export function sectionPanels(region: SectionRegion, count: number, extent: number, vacuum: boolean): SectionPanel[] {
  const result: SectionPanel[] = []
  const scale = Math.max(...region.conductors.map(c => Math.max(c.widthMm, c.zMm + c.thicknessMm)), ...region.dielectrics.map(d => d.zMm + d.thicknessMm))
  const probe = Math.min(...region.conductors.flatMap(c => [c.widthMm, c.thicknessMm]), ...region.dielectrics.map(d => d.thicknessMm)) * 1e-7
  const layers = vacuum ? [] : region.dielectrics
  /** Add one straight segment, with its outward metal normal (dielectric normals point up). */
  const edge = (x1: number, z1: number, x2: number, z2: number, group: number, er: number, tangent: number, contrast: number = 0, derivative: number = 0): void => {
    const dx = x2 - x1
    const dz = z2 - z1
    const length = Math.hypot(dx, dz)
    const steps = dz ? Math.max(4, Math.ceil(count / 3)) : count
    /** Quartic grading resolves the integrable corner charge singularity. */
    const grade = (i: number): number => i ** 4 / (i ** 4 + (steps - i) ** 4)
    for (let i = 0; i < steps; i++) {
      const lo = grade(i)
      const hi = grade(i + 1)
      result.push({ x: x1 + dx * (lo + hi) / 2, z: z1 + dz * (lo + hi) / 2, tx: dx / length, tz: dz / length, length: length * (hi - lo), group, er, tangent, contrast, derivative })
    }
  }
  for (const [group, c] of region.conductors.entries()) {
    const left = c.xMm - c.widthMm / 2
    const right = c.xMm + c.widthMm / 2
    const top = c.zMm + c.thicknessMm
    const bottomMaterial = material(layers, c.zMm - probe)
    const topMaterial = material(layers, top + probe)
    edge(left, c.zMm, right, c.zMm, group, bottomMaterial.er, bottomMaterial.lossTangent)
    edge(right, top, left, top, group, topMaterial.er, topMaterial.lossTangent)
    const cuts = coordinates([c.zMm, top, ...layers.flatMap(d => [d.zMm, d.zMm + d.thicknessMm]).filter(z => z > c.zMm + probe / 100 && z < top - probe / 100)], probe / 100)
    for (let k = 1; k < cuts.length; k++) {
      const adjacent = material(layers, (cuts[k - 1] + cuts[k]) / 2)
      edge(right, cuts[k - 1], right, cuts[k], group, adjacent.er, adjacent.lossTangent)
      edge(left, cuts[k], left, cuts[k - 1], group, adjacent.er, adjacent.lossTangent)
    }
  }
  const projections = region.conductors.flatMap(c => [c.xMm - c.widthMm / 2, c.xMm + c.widthMm / 2])
  const xs = coordinates([Math.min(...projections) - extent * scale, ...projections, Math.max(...projections) + extent * scale], probe / 100)
  const boundaries = coordinates(layers.flatMap(d => [d.zMm, d.zMm + d.thicknessMm]), probe / 100).filter(z => z > probe / 100 && (!region.height || z < region.height - probe / 100))
  for (const z of boundaries) {
    const below = material(layers, z - probe)
    const above = material(layers, z + probe)
    if (below.er === above.er && below.lossTangent === above.lossTangent) continue
    const contrast = 2 * (below.er - above.er) / (below.er + above.er)
    const derivative = 4 * below.er * above.er * (below.lossTangent - above.lossTangent) / (below.er + above.er) ** 2
    for (let k = 1; k < xs.length; k++) {
      const middle = (xs[k - 1] + xs[k]) / 2
      if (region.conductors.some(c => middle > c.xMm - c.widthMm / 2 && middle < c.xMm + c.widthMm / 2 && z >= c.zMm - probe && z <= c.zMm + c.thicknessMm + probe)) continue
      edge(xs[k - 1], z, xs[k], z, -1, 1, 0, contrast, derivative)
    }
  }
  return result
}

/** Reject unsupported/degenerate geometry rather than changing copper or material boundaries. */
export function validateSection(section: CrossSection): void {
  if (!section.conductors.length || !section.planes.length) fail('native_geometry', 'A cross-section needs signals and at least one solid reference plane')
  const ids = new Set(section.conductors.map(c => c.id))
  if (ids.size !== section.conductors.length || [...ids].some(id => !id)) fail('native_geometry', 'Cross-section conductor IDs must be unique and nonempty')
  for (const c of section.conductors) {
    if (![c.xMm, c.zMm, c.widthMm, c.thicknessMm, c.conductivitySm ?? copperConductivity].every(Number.isFinite) || c.widthMm <= 0 || c.thicknessMm <= 0 || (c.conductivitySm ?? copperConductivity) <= 0) fail('native_geometry', 'Finite positive conductor dimensions and conductivity required')
    if (section.planes.some(p => p.zMm >= c.zMm && p.zMm <= c.zMm + c.thicknessMm)) fail('native_geometry', 'A signal touches or crosses a reference plane')
  }
  for (const [i, a] of section.conductors.entries()) for (const b of section.conductors.slice(i + 1)) {
    if (Math.abs(a.xMm - b.xMm) <= (a.widthMm + b.widthMm) / 2 && a.zMm <= b.zMm + b.thicknessMm && b.zMm <= a.zMm + a.thicknessMm) fail('native_geometry', 'Signal rectangles overlap or touch')
  }
  for (const [i, p] of section.planes.entries()) if (![p.zMm, p.conductivitySm ?? copperConductivity].every(Number.isFinite) || (p.conductivitySm ?? copperConductivity) <= 0 || section.planes.slice(i + 1).some(q => q.zMm === p.zMm)) fail('native_geometry', 'Reference planes need unique finite heights and positive conductivity')
  for (const [i, a] of section.dielectrics.entries()) {
    if (![a.zMm, a.thicknessMm, a.er, a.lossTangent].every(Number.isFinite) || a.thicknessMm <= 0 || a.er < 1 || a.lossTangent < 0) fail('native_geometry', 'Finite positive slabs, er >= 1 and nonnegative loss tangent required')
    if (section.dielectrics.slice(i + 1).some(b => a.zMm < b.zMm + b.thicknessMm - 1e-12 && b.zMm < a.zMm + a.thicknessMm - 1e-12)) fail('native_geometry', 'Dielectric slabs overlap')
  }
}
