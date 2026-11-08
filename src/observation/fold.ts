import { numerics } from '../kernel'
import { fail } from './diagnostics'
import type { EyeGate, EyeSample, FoldOptions, FoldedEye, WaveformRows } from './types'

/** Validates representable array indices without imposing a window or sample budget. */
function eyeWindowCount(first: number, last: number, pointsPerWindow: number): number {
  const windows = last - first + 1
  if (![first,last,windows,pointsPerWindow,windows*pointsPerWindow].every(Number.isSafeInteger)) fail('eye_indices','Eye window and sample indices must be representable safe integers')
  return windows
}

/**
 * Fold one eye from recorded rows (was metrics.mjs foldProbeEye; `alignment` replaces the
 * `eye.captureTimesSeconds` override). A candidate window is folded iff it lies completely
 * inside both the measurement gate and the recording.
 */
export function foldProbeEye(rows: WaveformRows, eye: EyeGate, { alignment = { kind: 'stimulus-clock' }, pointsPerWindow = numerics.eyePlotPoints }: FoldOptions = {}): FoldedEye {
  const ui = eye.unitIntervalSeconds
  const origin = eye.timeOriginSeconds
  const column = eye.column
  if (!Number.isInteger(pointsPerWindow) || pointsPerWindow < 2) fail('eye_resolution', 'At least two plotting points per window required')
  if (!Number.isFinite(ui) || ui <= 0 || !Number.isFinite(origin)) fail('eye_timing', `${eye.name}: positive UI and finite timeOrigin required`)
  if (!Number.isInteger(column) || column < 1 || rows.some(row => column >= row.length)) fail('eye_probe', `${eye.name}: missing recorded probe column`)
  const lastRow = rows[rows.length - 1]
  const start = Math.max(rows[0][0], eye.startTimeSeconds)
  const end = Math.min(lastRow[0], eye.endTimeSeconds)
  // An opt-in DDR assessment supplies actual received capture times. The center
  // of those windows is the sampling edge, rather than a transmit-derived phase.
  const received = alignment.kind === 'received-differential-dqs'
  // timeOrigin is the stimulus start/bit-edge origin, not a recovered receive clock.
  // For b_k=origin+k*UI, [b_k-UI/2,b_k+3*UI/2] centers at b_k+UI/2 (mid-bit).
  const epsilon = numerics.eyeBoundaryToleranceUi // Boundary tolerance in UI units, independent of the time scale.
  const first = Math.ceil((start + ui / 2 - origin) / ui - epsilon)
  const last = Math.floor((end - 3 * ui / 2 - origin) / ui + epsilon)
  let origins: number[]
  if (alignment.kind === 'received-differential-dqs') {
    const captures: unknown = alignment.captureTimesSeconds
    if (Array.isArray(captures)) eyeWindowCount(0, captures.length - 1, pointsPerWindow)
    if (!Array.isArray(captures) || captures.some((t: number, i: number, a: number[]) => !Number.isFinite(t) || (i > 0 && t <= a[i - 1])))
      fail('eye_timing', 'Received capture times must be finite and strictly increasing')
    origins = (captures as number[]).map(t => t - ui).filter(t => t >= start && t + 2 * ui <= end)
  } else {
    if (!Number.isFinite(first) || !Number.isFinite(last) || first > last)
      fail('eye_windows', `${eye.name}: no complete two-UI windows within measurement gate [${eye.startTimeSeconds}, ${eye.endTimeSeconds}] s; UI ${ui} s; skip ${(eye.startTimeSeconds - origin) / ui} UI from timeOrigin ${origin} s; recorded timestamps [${rows[0][0]}, ${lastRow[0]}] s`)
    eyeWindowCount(first, last, pointsPerWindow)
    origins = Array.from({ length: last - first + 1 }, (_, i) => origin + (first + i) * ui - ui / 2)
  }
  const count = eyeWindowCount(0, origins.length - 1, pointsPerWindow)
  const samples: EyeSample[] = []
  const windowOriginsSeconds: number[] = []
  const boundaryIndices: number[] = []
  let index = 1
  for (let offsetIndex = 0; offsetIndex < count; offsetIndex++) {
    const k = first + offsetIndex
    const windowStart = origins[offsetIndex]
    const window = windowOriginsSeconds.length
    windowOriginsSeconds.push(windowStart)
    if (!received) boundaryIndices.push(k)
    index = 1
    for (let point = 0; point < pointsPerWindow; point++) {
      const offset = 2 * ui * point / (pointsPerWindow - 1)
      const time = windowStart + offset
      while (index < rows.length - 1 && rows[index][0] < time) index++
      const a = rows[index - 1]
      const b = rows[index]
      if (time < a[0] - ui * numerics.eyeInterpolationToleranceUi || time > b[0] + ui * numerics.eyeInterpolationToleranceUi) fail('eye_interpolation', 'Eye sample is outside the recorded waveform')
      samples.push([window, offset, time, a[column] + (b[column] - a[column]) * (time - a[0]) / (b[0] - a[0])])
    }
  }
  const values = rows.filter(row => row[0] >= start && row[0] <= end).map(row => row[column])
  for (const time of [start, end]) {
    const i = rows.findIndex(row => row[0] >= time)
    const b = rows[i]
    const a = rows[Math.max(0, i - 1)]
    if (b) values.push(a[0] === b[0] ? b[column] : a[column] + (b[column] - a[column]) * (time - a[0]) / (b[0] - a[0]))
  }
  const range = values.reduce<[number, number]>(([low, high], value) => [Math.min(low, value), Math.max(high, value)], [Infinity, -Infinity])
  return {
    samples, windows: windowOriginsSeconds.length, pointsPerWindow, windowOriginsSeconds, boundaryIndices,
    metrics: {
      kind: 'finite observed voltage eye', alignment: received ? 'received-differential-dqs' : 'stimulus-clock', samples: rows.length, voltageRangeV: range,
      unitIntervalSeconds: ui, timeOriginSeconds: received ? null : origin, measurementStartSeconds: eye.startTimeSeconds, measurementEndSeconds: eye.endTimeSeconds,
      observedStartSeconds: rows[0][0], observedEndSeconds: lastRow[0], windows: windowOriginsSeconds.length,
      limitations: ['No eye-opening estimator, BER extrapolation or protocol compliance; DDR checks, if configured, are reported separately'],
    },
  }
}
