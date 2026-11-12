import { type SectionGeometry, type RouteSlice, type RouteXY } from '../board'
import { solveCrossSection } from './cross-section'
import { sectionInverse } from './cross-section-matrix'
import { multiply, transpose } from './linalg'
import type { CrossSection, CrossSectionResult } from './cross-section-types'
import { routeCoupling, type RouteCoupling } from './route-coupling'

export interface ExtractedRouteSlice extends RouteSlice { key: string; line: CrossSectionResult }
export interface ExtractedRoutes {
  slices: ExtractedRouteSlice[]; cache: Map<string, CrossSectionResult>
  solveMilliseconds: number; geometryMilliseconds: number; warnings: string[]
  coupling: RouteCoupling[]
}
export interface RouteMaterials { maskMm: number; maskEr: number; maskLoss: number; substrateLoss: number }
export interface RouteFieldCache { panels: number; sections: Map<string, CrossSectionResult>; oblique: Map<string, number> }

/** Material slabs fill absent copper layers with the nearest laminate (rather than fictitious air gaps). */
export function routeCrossSection(geometry: SectionGeometry, slice: RouteSlice, materials: RouteMaterials): CrossSection {
  const layers = geometry.stack.copperLayers
  const bottom = Math.min(...layers.map(layer => layer.zMinMm))
  const top = Math.max(...layers.map(layer => layer.zMaxMm))
  const boundaries = [...new Set([bottom, top, ...geometry.stack.dielectrics.flatMap(layer => [layer.zMinMm, layer.zMaxMm])])].sort((a, b) => a - b)
  const dielectrics = boundaries.slice(1).map((z, i) => {
    const middle = (boundaries[i] + z) / 2
    const nearest = [...geometry.stack.dielectrics].sort((a, b) => Math.abs((a.zMinMm + a.zMaxMm) / 2 - middle) - Math.abs((b.zMinMm + b.zMaxMm) / 2 - middle))[0]
    return { zMm: boundaries[i], thicknessMm: z - boundaries[i], er: nearest.relativePermittivity!, lossTangent: materials.substrateLoss }
  })
  // Planar mask occupies spaces between outer traces as well as the assumed overcoat.
  const topCopper = layers.find(layer => layer.name === 'top')!
  const bottomCopper = layers.find(layer => layer.name === 'bottom')!
  const referenceLow = Math.min(...slice.references.map(plane => plane.z))
  const referenceHigh = Math.max(...slice.references.map(plane => plane.z))
  const lower = slice.references.length > 1 ? referenceLow : -Infinity
  const upper = slice.references.length > 1 ? referenceHigh : Infinity
  const clipped = dielectrics.filter(layer => layer.zMm >= lower - 1e-9 && layer.zMm + layer.thicknessMm <= upper + 1e-9)
  if (slice.wires.some(wire => wire.layer === 'top')) {
    const first = clipped.findIndex(layer => layer.zMm >= topCopper.zMinMm - 1e-9)
    if (first >= 0) clipped.splice(first)
    clipped.push({ zMm: topCopper.zMinMm, thicknessMm: topCopper.zMaxMm - topCopper.zMinMm + materials.maskMm, er: materials.maskEr, lossTangent: materials.maskLoss })
  }
  if (slice.wires.some(wire => wire.layer === 'bottom')) {
    const last = clipped.findIndex(layer => layer.zMm >= bottomCopper.zMaxMm - 1e-9)
    clipped.splice(0, Math.max(0, last))
    clipped.unshift({ zMm: bottomCopper.zMinMm - materials.maskMm, thicknessMm: bottomCopper.zMaxMm - bottomCopper.zMinMm + materials.maskMm, er: materials.maskEr, lossTangent: materials.maskLoss })
  }
  const offset = slice.wires[0].transverse
  return { conductors: slice.wires.map((wire, i) => {
    const layer = layers.find(layer => layer.name === wire.layer)!
    return { id: String(i), xMm: Number((wire.transverse - offset).toFixed(7)), zMm: layer.zMinMm, widthMm: wire.width, thicknessMm: layer.zMaxMm - layer.zMinMm }
  }), planes: slice.references.map(plane => ({ zMm: plane.z })), dielectrics: clipped }
}

/** Cache geometry only, independent of physical IDs, route position and longitudinal cell length. */
export function extractRoutes(geometry: SectionGeometry, materials: RouteMaterials, panels: number = 12, shared?: RouteFieldCache): ExtractedRoutes {
  const start = performance.now()
  if (shared && shared.panels !== panels) throw new Error('Field cache panel resolution disagrees with extraction')
  const cache = shared?.sections ?? new Map<string, CrossSectionResult>()
  let solveMilliseconds = 0
  /** Share exact relative geometry between pair screens and retained multiconductor solves. */
  const solve = (slice: RouteSlice): CrossSectionResult => {
    const section = routeCrossSection(geometry, slice, materials)
    const key = JSON.stringify(section)
    let line = cache.get(key)
    if (!line) {
      const time = performance.now()
      if (section.conductors.length > 40) throw new Error(`Local cross-section has ${section.conductors.length} conductors; exceeds modest-memory limit of 40`)
      try {
        line = solveCrossSection(section, { panelsPerEdge: panels })
      } catch (error) {
        throw Object.assign(error as Error, { routeSection: section, wires: slice.wires, references: slice.references, solved: cache.size, solveMilliseconds })
      }
      solveMilliseconds += performance.now() - time
      cache.set(key, line)
    }
    return line
  }
  const coupling: RouteCoupling[] = []
  const slices = geometry.slices.flatMap(slice => {
    if (slice.wires.length > 40) throw new Error(`Coupling screen has ${slice.wires.length} conductors; exceeds modest-memory limit of 40`)
    return routeCoupling(slice, solve, coupling)
  }).map(slice => ({ ...slice, key: JSON.stringify(routeCrossSection(geometry, slice, materials)), line: solve(slice) }))
  return { slices, cache, coupling, solveMilliseconds, geometryMilliseconds: performance.now() - start - solveMilliseconds, warnings: [...geometry.warnings,
    'Parallel coupling retains connected pairs until both abs(Cij)/sqrt(Cii*Cjj) and abs(Lij)/sqrt(Lii*Ljj) are below 0.005 (0.5%). Pair screening is not an aggregate waveform error bound. Geometry admission follows the recorded copper scope; fields beyond its cap and nonadjacent layers are unbounded omissions. Local solves are capped at 40 conductors and fail explicitly.'] }
}

/** Closest points on two finite centre-lines, used only for the explicit oblique correction. */
export function closestRoutePoints(a: RouteXY, b: RouteXY, c: RouteXY, d: RouteXY): { first: RouteXY; second: RouteXY; distance: number } {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const vx = d[0] - c[0]
  const vy = d[1] - c[1]
  const denominator = ux * vy - uy * vx
  const t = denominator ? ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / denominator : -1
  const s = denominator ? ((c[0] - a[0]) * uy - (c[1] - a[1]) * ux) / denominator : -1
  if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
    const point: RouteXY = [a[0] + t * ux, a[1] + t * uy]
    return { first: point, second: point, distance: 0 }
  }
  const pairs = [[a, c, d, false], [b, c, d, false], [c, a, b, true], [d, a, b, true]] as const
  return pairs.map(([point, start, end, reverse]) => {
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    const near: RouteXY = [start[0] + fraction * dx, start[1] + fraction * dy]
    return { first: reverse ? near : point as RouteXY, second: reverse ? point as RouteXY : near, distance: Math.hypot(point[0] - near[0], point[1] - near[1]) }
  }).sort((a, b) => a.distance - b.distance)[0]
}


/** Ideal AC rail voltages require induced return currents, rather than open series conductors. */
export function referenceSeries(line: CrossSectionResult, grounded: number[]): Pick<CrossSectionResult, 'L' | 'skinResistance'> {
  if (!grounded.length) return line
  const size = line.L.length
  const active = Array.from({ length: size }, (_, i) => i).filter(i => !grounded.includes(i))
  const inverse = sectionInverse(grounded.map(i => grounded.map(j => line.L[i][j])))
  const current = line.L.map((row, i) => row.map((_, j) => Number(i === j && !grounded.includes(i))))
  for (const [i, row] of grounded.entries()) for (const column of active) current[row][column] = -grounded.reduce((sum, index, j) => sum + inverse[i][j] * line.L[index][column], 0)
  const projection = transpose(current)
  return { L: multiply(projection, multiply(line.L, current)), skinResistance: multiply(projection, multiply(line.skinResistance, current)) }
}
