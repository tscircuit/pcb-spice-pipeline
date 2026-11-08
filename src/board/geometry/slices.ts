import type { CrossSection, CopperPoint, CopperPolygon, SliceConductor } from './types'
import { fail } from '../diagnostics'

export interface CopperShape { id: string; net: string; layer: string; polygon: CopperPolygon }
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
  const sorted = [...slice.conductors].sort((a, b) => a.zMin - b.zMin || a.group - b.group || a.xMin - b.xMin)
  const merged: SliceConductor[] = []
  for (const c of sorted) {
    const previous = merged.at(-1)
    if (previous && c.zMin === previous.zMin && c.zMax === previous.zMax && c.group === previous.group && c.xMin <= previous.xMax + 1e-9) previous.xMax = Math.max(previous.xMax, c.xMax)
    else merged.push({ ...c })
  }
  for (let i = 0; i < merged.length; i++) for (const b of merged.slice(i + 1)) {
    const a = merged[i]
    if (a.group !== b.group && Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin) > 1e-8 && Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin) > 1e-8) fail('conductor_overlap', `${a.id} overlaps ${b.id} on different nets`)
  }
  slice.conductors = merged
}
