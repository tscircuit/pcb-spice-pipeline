import { boardPosition, type BoardRouteSegment, type BoardStackup, type BoardPosition } from '../board'
import type { RouteSpatialWaveform } from './route-spatial'
import type { RoutedCapture } from './routed-types'

export interface RouteVoltageBlend {
  before: number
  after: number
  fraction: number
}
export interface RouteVoltagePosition {
  index: number
  position: number
  gap: number
}

/** Project saved native nodes onto the physical routed polyline, including bends and via depth. */
export function routeVoltagePositions(
  route: BoardRouteSegment[],
  stack: BoardStackup,
  waveform: RouteSpatialWaveform,
  indices: number[],
): RouteVoltagePosition[] {
  return indices
    .flatMap((index) => {
      const point = waveform.points[index]
      const world = boardPosition(stack, point.x, point.y, point.layer)
      const near = route
        .filter((segment) => segment.kind === 'via' || segment.layer === point.layer || segment.toLayer === point.layer)
        .map((segment) => {
          const delta = segment.b.map((value, axis) => value - segment.a[axis])
          const length = segment.end - segment.start
          const fraction = Math.max(
            0,
            Math.min(1, delta.reduce((sum, value, axis) => sum + value * (world[axis] - segment.a[axis]), 0) / length ** 2),
          )
          const gap = Math.hypot(...segment.a.map((value, axis) => world[axis] - value - fraction * delta[axis]))
          return { index, position: segment.start + fraction * length, gap }
        })
        .sort((a, b) => a.gap - b.gap)[0]
      return near && near.gap < 1e-4 ? [near] : []
    })
    .sort((a, b) => a.position - b.position)
}

/** Interpolate by routed arc length rather than straight-line proximity across adjacent bends. */
export function routeVoltageBlend(points: RouteVoltagePosition[], position: number): RouteVoltageBlend | undefined {
  if (!points.length) return undefined
  const after = points.findIndex((point) => point.position >= position)
  if (after <= 0) {
    const index = points[after === 0 ? 0 : points.length - 1].index
    return { before: index, after: index, fraction: 0 }
  }
  const first = points[after - 1]
  const last = points[after]
  return { before: first.index, after: last.index, fraction: (position - first.position) / Math.max(1e-12, last.position - first.position) }
}

/** Bilinear interpolation of native time samples and physical route distance; no propagation model is invented. */
export function routeVoltageAt(waveform: RouteSpatialWaveform, blend: RouteVoltageBlend, time: number): number {
  const times = waveform.timeSeconds
  const after = times.findIndex((value) => value >= time)
  const high = after < 0 ? times.length - 1 : after
  const low = Math.max(0, high - 1)
  const fraction = high === low ? 0 : Math.max(0, Math.min(1, (time - times[low]) / (times[high] - times[low])))
  /** Preserve the saved node's actual adaptive/decimated time grid. */
  const sample = (index: number): number => waveform.volts[index][low] * (1 - fraction) + waveform.volts[index][high] * fraction
  return sample(blend.before) * (1 - blend.fraction) + sample(blend.after) * blend.fraction
}

export interface RouteVoltageRange {
  low: number
  high: number
}
type ProbeCapture = Pick<RoutedCapture, 'probes' | 'timestampsSeconds'>

/** Fit the colour scale to the actual captured probe swing instead of a fixed supply guess. */
export function routeVoltageRange(captures: ProbeCapture[]): RouteVoltageRange {
  const samples = captures.flatMap((capture) => capture.probes.flatMap((probe) => probe.voltageLevels))
  if (!samples.length) return { low: 0, high: 1 }
  const low = samples.reduce((value, sample) => Math.min(value, sample), Infinity)
  const high = samples.reduce((value, sample) => Math.max(value, sample), -Infinity)
  return high - low < 1e-6 ? { low: low - 0.5, high: high + 0.5 } : { low, high }
}

/** The first time any probe crosses the middle of its own swing; 0 when nothing switches. */
export function routeFirstEdge(captures: ProbeCapture[]): number {
  let first = Infinity
  for (const capture of captures)
    for (const probe of capture.probes) {
      const values = probe.voltageLevels
      const low = Math.min(...values)
      const high = Math.max(...values)
      if (high - low < 1e-3) continue
      const middle = (low + high) / 2
      const index = values.findIndex((value, i) => i > 0 && (values[i - 1] - middle) * (value - middle) <= 0 && values[i - 1] !== value)
      if (index > 0) first = Math.min(first, capture.timestampsSeconds[index])
    }
  return Number.isFinite(first) ? first : 0
}
