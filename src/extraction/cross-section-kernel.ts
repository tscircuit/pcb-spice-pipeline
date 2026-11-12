import type { SectionPanel } from './cross-section-types'

const quadrature = [
  [-.8611363115940526, .3478548451374538],
  [-.3399810435848563, .6521451548625461],
  [.3399810435848563, .6521451548625461],
  [.8611363115940526, .3478548451374538],
]

/** Antiderivative of log distance, including points on a source panel. */
function primitive(x: number, y: number): number {
  return x * Math.log(Math.hypot(x, y) || 1) - x + (y ? Math.abs(y) * Math.atan(x / Math.abs(y)) : 0)
}

/** Second antiderivative of log distance, for exact Galerkin integration of parallel panels. */
function secondPrimitive(x: number, y: number): number {
  const r = Math.hypot(x, y)
  return (r ? .5 * (x * x - y * y) * Math.log(r) : 0) - .75 * x * x + (y ? Math.abs(y) * x * Math.atan(x / Math.abs(y)) : 0)
}

/** Normal derivative of the second primitive; the coplanar principal value is zero. */
function secondNormal(x: number, y: number): number {
  return y ? Math.sign(y) * (x * Math.atan(x / Math.abs(y)) - Math.abs(y) * (Math.log(Math.hypot(x, y)) + .5)) : 0
}

/** Analytic source integral, with four-point target averaging, for the free-space logarithmic kernel. */
function freeKernel(a: SectionPanel, b: SectionPanel, mirror: boolean, normal: boolean): number {
  const tz = mirror ? -b.tz : b.tz
  const dx = a.x - b.x
  const dz = a.z - (mirror ? -b.z : b.z)
  const parallel = Math.abs(a.tx * tz - a.tz * b.tx) < 1e-14
  if (parallel && Math.max(a.length, b.length) < 30 * Math.min(a.length, b.length) && Math.hypot(dx, dz) < 3 * Math.max(a.length, b.length)) {
    const u = dx * b.tx + dz * tz
    const v = -dx * tz + dz * b.tx
    const h = (a.length + b.length) / 2
    const d = (a.length - b.length) / 2
    /** Exact potential or upward field primitive at one endpoint pair. */
    const at = (x: number): number => normal ? tz * primitive(x, v) + b.tx * secondNormal(x, v) : -secondPrimitive(x, v)
    return (at(u + h) - at(u + d) - at(u - d) + at(u - h)) / (2 * Math.PI * a.length * b.length)
  }
  // For unequal potential panels, average over the shorter panel and integrate the longer one.
  if (!normal && !mirror && a.length > b.length) return freeKernel(b, a, false, false)
  let result = 0
  for (const [t, weight] of quadrature) {
    const dx = a.x + t * a.tx * a.length / 2 - b.x
    const dz = a.z + t * a.tz * a.length / 2 - (mirror ? -b.z : b.z)
    const tz = mirror ? -b.tz : b.tz
    const u = dx * b.tx + dz * tz
    const v = -dx * tz + dz * b.tx
    const h = b.length / 2
    let value: number
    if (normal) {
      const along = Math.log(Math.hypot(u + h, v) / Math.hypot(u - h, v)) / b.length
      const across = Math.abs(v) < 1e-15 ? 0 : Math.sign(v) * (Math.atan((u + h) / Math.abs(v)) - Math.atan((u - h) / Math.abs(v))) / b.length
      value = (tz * along + b.tx * across) / (2 * Math.PI)
    } else value = -(primitive(u + h, v) - primitive(u - h, v)) / (2 * Math.PI * b.length)
    result += value * weight / 2
  }
  return result
}

/** Grounded half-space or exact two-plane Green function; no meshed planes or vertical truncation.
 * The logarithmic singularity is integrated analytically. Only the smooth two-plane correction
 * needs double quadrature. Dielectric rows request the upward normal electric field instead.
 */
export function sectionKernel(a: SectionPanel, b: SectionPanel, height: number): number {
  const normal = a.group < 0
  const self = a === b ? (normal ? 0 : (-Math.log(a.length) + 1.5) / (2 * Math.PI)) : freeKernel(a, b, false, normal)
  if (!height) return self - freeKernel(a, b, true, normal)
  if (Math.abs(a.x - b.x) - (a.length + b.length) / 2 > 200 * height) return 0
  const near = Math.hypot(a.x - b.x, a.z - b.z) < 2 * (a.length + b.length)
  let result = near ? self : 0
  for (const [ta, wa] of quadrature) for (const [tb, wb] of quadrature) {
    const dx = a.x + ta * a.tx * a.length / 2 - b.x - tb * b.tx * b.length / 2
    const za = a.z + ta * a.tz * a.length / 2
    const zb = b.z + tb * b.tz * b.length / 2
    const dz = za - zb
    const u = Math.PI * dx / height
    const v = Math.PI * dz / height
    const s = Math.PI * (za + zb) / height
    const denominator = 2 * (Math.sinh(u / 2) ** 2 + Math.sin(v / 2) ** 2)
    const difference = 2 * Math.sin(Math.PI * za / height) * Math.sin(Math.PI * zb / height)
    const numerator = denominator + difference
    let value = normal ? (Math.sin(v) / denominator - Math.sin(s) / numerator) / (4 * height) : Math.log1p(difference / denominator) / (4 * Math.PI)
    if (near) value -= normal ? dz / (2 * Math.PI * (dx * dx + dz * dz)) : -Math.log(Math.hypot(dx, dz)) / (2 * Math.PI)
    if (dx === 0 && dz === 0) value = normal ? -Math.sin(s) / (4 * height * numerator) : Math.log(numerator * 2 * (height / Math.PI) ** 2) / (4 * Math.PI)
    result += wa * wb * value / 4
  }
  return result
}
