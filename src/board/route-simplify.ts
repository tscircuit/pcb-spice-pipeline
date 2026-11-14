import type { RouteWire, RouteXY } from './route-sections'

/** Maximum point-to-chord distance in mm. */
function chordDistance(point: RouteXY, a: RouteXY, b: RouteXY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
}

/** Bounded Douglas-Peucker chords for densely tessellated curved routes; physical records remain unchanged. */
export function simplifyRouteWires(wires: RouteWire[], toleranceMm: number): { wires: RouteWire[]; originalLengthMm: number; simplifiedLengthMm: number } {
  const output: RouteWire[] = []
  let index = 0
  while (index < wires.length) {
    const seed = wires[index++]
    const run = [seed]
    while (index < wires.length) {
      const wire = wires[index]
      const previous = run.at(-1)!
      if (wire.trace !== seed.trace || wire.layer !== seed.layer || wire.width !== seed.width || Math.hypot(wire.a[0] - previous.b[0], wire.a[1] - previous.b[1]) > 1e-7) break
      run.push(wire)
      index++
    }
    const points = [seed.a, ...run.map(wire => wire.b)]
    /** Recursive chord acceptance bounds every original vertex, preserving width/layer/via boundaries. */
    const simplify = (start: number, end: number): void => {
      let farthest = -1
      let distance = toleranceMm
      for (let i = start + 1; i < end; i++) {
        const candidate = chordDistance(points[i], points[start], points[end])
        if (candidate > distance) {
          distance = candidate
          farthest = i
        }
      }
      if (farthest >= 0) {
        simplify(start, farthest)
        simplify(farthest, end)
      } else {
        const a = points[start]
        const b = points[end]
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (length < 1e-9) return
        const direction = b[0] - a[0] < -1e-9 || (Math.abs(b[0] - a[0]) < 1e-9 && b[1] < a[1]) ? -1 : 1
        const u: RouteXY = [direction * (b[0] - a[0]) / length, direction * (b[1] - a[1]) / length]
        const first = a[0] * u[0] + a[1] * u[1]
        const last = b[0] * u[0] + b[1] * u[1]
        output.push({ ...seed, id: output.length, a, b, u, start: Math.min(first, last), end: Math.max(first, last), transverse: -a[0] * u[1] + a[1] * u[0] })
      }
    }
    simplify(0, points.length - 1)
  }
  return { wires: output, originalLengthMm: wires.reduce((sum, wire) => sum + wire.end - wire.start, 0), simplifiedLengthMm: output.reduce((sum, wire) => sum + wire.end - wire.start, 0) }
}
