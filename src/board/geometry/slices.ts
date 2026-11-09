import { numerics } from '../../kernel'
import type { CrossSection, CopperPoint, CopperPolygon, SliceConductor } from './types'
import { fail } from '../diagnostics'

export interface CopperShape { id: string; net: string; physicalNet?: string; layer: string; polygon: CopperPolygon }
/** Intersects a whole polygon, including voids, with a plane at longitudinal coordinate t. */
export function sliceIntervals(polygon: CopperPolygon, dx: number, dy: number, t: number): [number, number][] {
  const crossings: number[] = []
  for (const ring of polygon) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const ta = a[0] * dx + a[1] * dy
    const tb = b[0] * dx + b[1] * dy
    if ((ta > t) === (tb > t)) continue
    const fraction = (t - ta) / (tb - ta)
    crossings.push(-(a[0] + fraction * (b[0] - a[0])) * dy + (a[1] + fraction * (b[1] - a[1])) * dx)
  }
  crossings.sort((a, b) => a - b)
  return crossings.filter((_, i) => i % 2 === 0).map((v, i) => [v, crossings[2 * i + 1]])
}
/** A physical wire's copper outline, without any length straightening. */
export function wirePolygon(a: CopperPoint, b: CopperPoint, width: number): CopperPolygon {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const x = -(b[1] - a[1]) / length * width / 2
  const y = (b[0] - a[0]) / length * width / 2
  return [[[a[0] + x, a[1] + y], [b[0] + x, b[1] + y], [b[0] - x, b[1] - y], [a[0] - x, a[1] - y]]]
}
/** Unions touching metal on the same electrical net, rejecting physical shorts. */
export function mergeConductors(slice: CrossSection): void {
  const source = slice.conductors.map(c => ({ ...c, penetrationMm: c.penetrationMm ?? Number((c.zMax - c.zMin).toFixed(numerics.stackupCoordinateDigits)) }))
  for (let i = 0; i < source.length; i++) for (const b of source.slice(i + 1)) {
    const a = source[i]
    if ((a.group !== b.group || a.physicalNet !== b.physicalNet) && Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin) > numerics.boundaryToleranceMm && Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin) > numerics.boundaryToleranceMm) fail('conductor_overlap', `${a.id} overlaps ${b.id} on different nets`)
  }
  const heights = [...new Set(source.flatMap(c => [c.zMin, c.zMax]))].sort((a, b) => a - b)
  const merged: SliceConductor[] = []
  for (let i = 1; i < heights.length; i++) {
    const zMin = heights[i - 1]
    const zMax = heights[i]
    const row = source.filter(c => c.zMin <= zMin && c.zMax >= zMax).sort((a, b) => a.group - b.group || (a.physicalNet ?? '').localeCompare(b.physicalNet ?? '') || a.xMin - b.xMin)
    const spans: SliceConductor[] = []
    for (const c of row) {
      const last = spans.at(-1)
      if (last && last.group === c.group && last.physicalNet === c.physicalNet && c.xMin <= last.xMax + numerics.boundaryToleranceMm) {
        if (last.conductivitySm !== c.conductivitySm) fail('slice_conductor', 'Touching copper with different conductivities needs a material-interface model')
        last.xMax = Math.max(last.xMax, c.xMax)
        last.id = [last.id, c.id].sort()[0]
      } else spans.push({ ...c, zMin, zMax })
    }
    for (const c of spans) {
      const below = merged.find(b => b.group === c.group && b.physicalNet === c.physicalNet && b.conductivitySm === c.conductivitySm && b.penetrationMm === c.penetrationMm && b.xMin === c.xMin && b.xMax === c.xMax && b.zMax === c.zMin)
      if (below) below.zMax = c.zMax
      else merged.push(c)
    }
  }
  slice.conductors = merged
}
