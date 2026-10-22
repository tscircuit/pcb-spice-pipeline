import { readFileSync } from 'node:fs'
// src is shipped: this same relative import/asset URL works from src and dist.
import { initSync, triangulate } from '../src/vendor/spade/mesh.js'

type Point = [number, number]
type XYZ = [number, number, number]
export interface QualityMeshOptions {
  maxPanelLengthMm: number
  /** Cap refinement target; side triangles are audited to this angle. Default: 15 degrees. */
  minAngleDeg?: number
  /** Default: 0.5 mm². Does not replace the edge-length bound. */
  maxAreaMm2?: number
  /** Total per-cap-polygon limit, including input, Spade and edge-split vertices. Default: 300000. */
  maxVertices?: number
  /** Total cap + side triangles per surfacePanels/conductor. Default: 2 * maxVertices; maximum: 2000000. */
  maxPanels?: number
}

let initialized = false
let trapped = false
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const ringArea = (ring: Point[]) => ring.slice(1, -1).reduce((sum, p, i) => sum + cross(ring[0], p, ring[i + 2]), 0) / 2
const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const key = (p: Point) => `${p[0]},${p[1]}`
const reject = (message: string): never => { throw new Error(`quality_mesh: ${message}`) }

export function qualityMeshSettings(options: QualityMeshOptions) {
  const { maxPanelLengthMm, minAngleDeg = 15, maxAreaMm2 = .5, maxVertices = 300000, maxPanels = 2 * maxVertices } = options
  if (!Number.isFinite(maxPanelLengthMm) || maxPanelLengthMm <= 0 || !Number.isFinite(maxAreaMm2) || maxAreaMm2 <= 0 ||
      !Number.isFinite(minAngleDeg) || minAngleDeg <= 0 || minAngleDeg > 30 || !Number.isFinite(1 / Math.tan(minAngleDeg * Math.PI / 180)) ||
      !Number.isSafeInteger(maxVertices) || maxVertices < 3 || maxVertices > 1000000 ||
      !Number.isSafeInteger(maxPanels) || maxPanels < 1 || maxPanels > 2000000) reject('Invalid parameters (angle in (0,30], vertex limit in [3,1000000], panel limit in [1,2000000])')
  return { maxPanelLengthMm, minAngleDeg, maxAreaMm2, maxVertices, maxPanels }
}

/** Shape-preserving vertical rectangle subdivision; two T per cell with (a,b,up) winding.
 * Independent of cap Steiner points: cap/side and slab T-junctions can remain.
 * No native panel-area cutoff is used: every positive fine face is retained.
 */
export function* qualitySidePanels(a: Point, b: Point, low: number, high: number, options: QualityMeshOptions): Generator<XYZ[]> {
  const { maxPanelLengthMm: limit, minAngleDeg, maxAreaMm2, maxPanels } = qualityMeshSettings(options)
  const width = length(a,b), height = high - low, aspect = 1 / Math.tan(minAngleDeg * Math.PI / 180)
  if ([...a,...b,low,high].some(v => !Number.isFinite(v) || Math.abs(v) > 1e9) || width <= 0 || height <= 0) reject('Invalid side rectangle')
  // Each axis gets L/sqrt(2), so the emitted triangle diagonal also meets L.
  // Leave roundoff headroom; audit actual coordinates rather than ideal steps.
  const axis = Math.min(limit / Math.SQRT2, Math.sqrt(maxAreaMm2) * Math.SQRT2) * (1 - 32 * Number.EPSILON)
  let nx = Math.ceil(width / axis), nz = Math.ceil(height / axis)
  // With angle <= 30 degrees, cot(angle)^2 >= 3; rounding up one axis
  // cannot make the other exceed the aspect bound, so one adjustment suffices.
  if (width / nx > aspect * (height / nz)) nx = Math.ceil(width / (aspect * (height / nz)))
  else if (height / nz > aspect * (width / nx)) nz = Math.ceil(height / (aspect * (width / nx)))
  // Check before allocating/emitting, including overflow and subnormal limits.
  if (![nx,nz].every(n => Number.isSafeInteger(n) && n > 0) || nx > Math.floor(maxPanels / 2 / nz)) reject('Side panel budget exceeded')
  const xy = (i: number): Point => i === 0 ? a : i === nx ? b : [a[0] + (b[0]-a[0]) * (i/nx), a[1] + (b[1]-a[1]) * (i/nx)]
  const z = (i: number) => i === 0 ? low : i === nz ? high : low + height * (i/nz)
  let totalArea = 0, correction = 0
  for (let i = 0; i < nx; i++) {
    const u = xy(i), v = xy(i+1), w = length(u,v)
    for (let j = 0; j < nz; j++) {
      const bottom = z(j), top = z(j+1), h = top-bottom, cellArea = w*h
      if (!Number.isFinite(cellArea) || cellArea / 2 <= 0 || cellArea / 2 > maxAreaMm2 * (1 + 1e-10) ||
          Math.hypot(v[0]-u[0],v[1]-u[1],h) > limit || Math.atan2(Math.min(w,h),Math.max(w,h)) * 180 / Math.PI < minAngleDeg - 1e-8) reject('Side geometry/area/angle/edge length below coordinate resolution')
      const add = cellArea - correction, next = totalArea + add
      correction = (next-totalArea)-add; totalArea = next
      const p: XYZ = [u[0],u[1],bottom], q: XYZ = [v[0],v[1],bottom], r: XYZ = [v[0],v[1],top], s: XYZ = [u[0],u[1],top]
      yield [p,q,r]; yield [p,r,s]
    }
  }
  if (Math.abs(totalArea-width*height) > width*height*1e-9) reject('Side area not preserved')
}

/** Synchronous, opt-in Node mesher. Rings must already be cleaned and unclosed.
 * Boundary Steiner vertices retain the original straight segments. Independent
 * side subdivision still leaves T-junctions requiring solver validation.
 */
export function qualityMesh(rings: Point[][], options: QualityMeshOptions) {
  try {
    const { maxPanelLengthMm: limit, minAngleDeg, maxAreaMm2, maxVertices, maxPanels } = qualityMeshSettings(options)
    const points: Point[] = [], segments: number[] = [], original = new Set<string>()
    if (!rings.length) reject('At least one ring required')
    for (const ring of rings) {
      if (ring.length < 3 || ring.length > maxVertices - points.length) reject('Invalid ring or vertex budget exceeded')
      const start = points.length
      for (const p of ring) {
        if (p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9 || v !== 0 && Math.abs(v) < 1.793662034335766e-43)) reject('Invalid coordinate')
        if (original.has(key(p))) reject('Repeated or touching boundary vertex')
        original.add(key(p)); points.push([p[0], p[1]])
      }
      if (!Number.isFinite(ringArea(ring)) || ringArea(ring) === 0) reject('Degenerate ring')
      for (let i = 0; i < ring.length; i++) segments.push(start + i, start + (i + 1) % ring.length)
    }
    if (trapped) reject('WASM trapped previously; use a fresh worker/process')
    if (!initialized) {
      initSync({ module: readFileSync(new URL('../src/vendor/spade/mesh_bg.wasm', import.meta.url)) })
      initialized = true
    }
    const mesh = triangulate(new Float64Array(points.flat()), new Uint32Array(segments), minAngleDeg, maxAreaMm2, maxVertices - points.length)
    let indices: number[]
    try {
      if (!mesh.complete) reject('Spade refinement incomplete: vertex budget exhausted')
      const xy = mesh.points, triangles = mesh.triangles // getters copy before free
      if (xy.length % 2 || !triangles.length || triangles.length % 3 || xy.length / 2 > maxVertices || triangles.length / 3 > 2 * maxVertices) reject('Invalid WASM output size')
      if (triangles.length / 3 > maxPanels) reject('Panel budget exceeded')
      points.length = 0
      for (let i = 0; i < xy.length; i += 2) {
        if (!Number.isFinite(xy[i]) || !Number.isFinite(xy[i + 1])) reject('Nonfinite WASM output')
        points.push([xy[i], xy[i + 1]])
      }
      indices = Array.from(triangles)
    } finally { mesh.free() }
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3)
      if ([a, b, c].some(v => v >= points.length)) reject('Invalid triangle index')
      const signed = cross(points[a], points[b], points[c])
      if (!Number.isFinite(signed) || signed === 0) reject('Degenerate triangle')
      if (signed < 0) [indices[i + 1], indices[i + 2]] = [c, b]
    }
    // Conforming red/green subdivision enforces length independently of area.
    // Shared cap edge midpoints are reused; sides use an independent grid.
    for (let pass = 0; ; pass++) {
      const midpoints = new Map<string, number>()
      const edgeKey = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`
      for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
        const a = indices[i + j], b = indices[i + (j + 1) % 3], edge = edgeKey(a, b)
        if (length(points[a], points[b]) <= limit || midpoints.has(edge)) continue
        if (points.length >= maxVertices || pass >= 64) reject('Edge-length refinement exhausted vertex/pass budget')
        const p: Point = [points[a][0] / 2 + points[b][0] / 2, points[a][1] / 2 + points[b][1] / 2]
        if (key(p) === key(points[a]) || key(p) === key(points[b])) reject('Edge length below coordinate resolution')
        midpoints.set(edge, points.length); points.push(p)
      }
      if (!midpoints.size) break
      const refined: number[] = []
      for (let i = 0; i < indices.length; i += 3) {
        const v = indices.slice(i, i + 3), m = v.map((a, j) => midpoints.get(edgeKey(a, v[(j + 1) % 3])))
        const count = m.filter(v => v !== undefined).length
        if (refined.length / 3 + (count === 3 ? 4 : count + 1) > maxPanels) reject('Panel budget exceeded during edge-length refinement')
        if (!count) { refined.push(...v); continue }
        if (count === 3) { const [a,b,c] = v, [ab,bc,ca] = m as number[]; refined.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca); continue }
        // Rotate so the split edge is first (one split) or the unsplit edge last (two).
        const start = count === 1 ? m.findIndex(v => v !== undefined) : (m.findIndex(v => v === undefined) + 1) % 3
        const [a,b,c] = [v[start],v[(start+1)%3],v[(start+2)%3]], ab = m[start]!, bc = m[(start+1)%3]!
        if (count === 1) refined.push(a,ab,c, ab,b,c)
        else {
          refined.push(ab,b,bc)
          if (length(points[a],points[bc]) < length(points[ab],points[c])) refined.push(a,ab,bc, a,bc,c)
          else refined.push(a,ab,c, ab,bc,c)
        }
      }
      indices = refined
    }
    // Audit oriented manifold edges and the full boundary, including every hole.
    const edges = new Map<number, { a: number; b: number; count: number; orientation: number }>(), n = points.length
    let totalArea = 0, correction = 0, minAngleDegFound = 180, trianglesBelowTarget = 0
    for (let i = 0; i < indices.length; i += 3) {
      const v = indices.slice(i, i + 3), [a,b,c] = v.map(i => points[i]), twiceArea = cross(a,b,c)
      const sides = [length(a,b),length(b,c),length(c,a)]
      if (!Number.isFinite(twiceArea) || twiceArea <= 0 || twiceArea / 2 > maxAreaMm2 * (1 + 1e-10) || sides.some(s => s > limit)) reject('Invalid triangle geometry/area/edge length')
      const add = twiceArea / 2 - correction, next = totalArea + add
      correction = (next - totalArea) - add; totalArea = next
      const angle = Math.min(...sides.map((s,j) => Math.atan2(twiceArea, (s*s + sides[(j+1)%3]**2 - sides[(j+2)%3]**2) / 2) * 180 / Math.PI))
      minAngleDegFound = Math.min(minAngleDegFound, angle)
      if (angle < minAngleDeg - 1e-8) trianglesBelowTarget++
      for (let j = 0; j < 3; j++) {
        const a = v[j], b = v[(j+1)%3], id = Math.min(a,b) * n + Math.max(a,b)
        const e = edges.get(id) ?? { a, b, count: 0, orientation: 0 }
        e.count++; e.orientation += a < b ? 1 : -1; edges.set(id,e)
        if (e.count > 2 || e.count === 2 && e.orientation !== 0) reject('Nonmanifold/overlapping triangles')
      }
    }
    const boundary = new Map<number,number>(), vertices = new Map(points.map((p,i) => [key(p),i]))
    for (const e of edges.values()) if (e.count === 1) {
      if (boundary.has(e.a)) reject('Ambiguous mesh boundary')
      boundary.set(e.a,e.b)
    }
    const epsilon = points.reduce((s,p) => Math.max(s,Math.abs(p[0]),Math.abs(p[1])),1) * Number.EPSILON * 64
    let visited = 0, polygonArea = 0, perimeter = 0
    for (const [r, ring] of rings.entries()) {
      polygonArea += (r ? -1 : 1) * Math.abs(ringArea(ring))
      const oriented = (ringArea(ring) > 0) === (r === 0) ? ring : [...ring].reverse()
      for (let j = 0; j < oriented.length; j++) {
        const a = oriented[j], b = oriented[(j+1)%oriented.length], size = length(a,b)
        const start = vertices.get(key(a)), end = vertices.get(key(b))
        if (start === undefined || end === undefined) reject('Original boundary vertex lost')
        perimeter += size
        let current: number = start!, previousT = 0
        while (current !== end) {
          const next = boundary.get(current)
          if (next === undefined || ++visited > boundary.size) reject('Boundary/cutout not preserved')
          const p = points[next!], t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / size**2
          if (Math.abs(cross(a,b,p)) > epsilon * size || t <= previousT || t > 1 + epsilon / size) reject('Boundary moved or reversed')
          previousT = t; current = next!
        }
      }
    }
    if (visited !== boundary.size || polygonArea <= 0 || Math.abs(totalArea-polygonArea) > Math.max(polygonArea*1e-9,epsilon*perimeter*8)) reject('Polygon area/cutouts not preserved')
    return { points, indices, minAngleDeg: minAngleDegFound, trianglesBelowTarget }
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) trapped = true
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('quality_mesh:')) throw error
    return reject(message)
  }
}
