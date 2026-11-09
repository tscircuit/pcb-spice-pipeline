import type { WaveformRows } from './types'

/** Interpolate an actual adaptive solver trace at a bounded time. */
export function sampleVoltage(rows: WaveformRows, column: number, time: number): number {
  const first = rows[0][0]
  const last = rows.at(-1)![0]
  const epsilon = Math.max(Math.abs(last), Number.MIN_VALUE) * 1e-12
  if (time < first - epsilon || time > last + epsilon) throw new Error('Measurement time is outside the recording')
  time = Math.max(first, Math.min(last, time))
  let low = 0
  let high = rows.length - 1
  while (high - low > 1) {
    const mid = (low + high) >>> 1
    if (rows[mid][0] <= time) low = mid
    else high = mid
  }
  const a = rows[low]
  const b = rows[high]
  return a[column] + (b[column] - a[column]) * (time - a[0]) / (b[0] - a[0])
}
/** Both edge polarities at a receiver threshold, linearly interpolated. */
export function crossingTimes(rows: WaveformRows, column: number, threshold: number, start: number): number[] {
  const times: number[] = []
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if ((a[column] < threshold && b[column] >= threshold) || (a[column] > threshold && b[column] <= threshold)) {
      const t = a[0] + (threshold - a[column]) * (b[0] - a[0]) / (b[column] - a[column])
      if (t >= start && t !== times.at(-1)) times.push(t)
    }
  }
  return times
}
/** Signed extrema relative to the separately solved undisturbed idle voltage. */
export function quietPeak(rows: WaveformRows, column: number, start: number, idle: number): { idle_voltage_v: number; peak_positive_v: number; peak_negative_v: number } {
  let positive = Math.max(0, sampleVoltage(rows, column, start) - idle)
  let negative = Math.min(0, sampleVoltage(rows, column, start) - idle)
  for (const row of rows) if (row[0] > start) {
    positive = Math.max(positive, row[column] - idle)
    negative = Math.min(negative, row[column] - idle)
  }
  return { idle_voltage_v: idle, peak_positive_v: positive, peak_negative_v: negative }
}
export interface Capture { time: number; high: boolean }
export interface EyeMeasurement {
  traces: { timestamps_s: number[]; voltage_levels: number[] }[]; height: number; width: number; margin: number
}
/** Threshold-valid continuous intervals for one fixed transmitted bit, clipped to the recording. */
export function validIntervals(rows: WaveformRows, column: number, high: boolean, threshold: number): [number, number][] {
  const intervals: [number, number][] = []
  /** Validity includes equality at the threshold. */
  const valid = (value: number): boolean => high ? value >= threshold : value <= threshold
  let start: number | undefined = valid(rows[0][column]) ? rows[0][0] : undefined
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (valid(a[column]) === valid(b[column])) continue
    const time = a[0] + (threshold - a[column]) * (b[0] - a[0]) / (b[column] - a[column])
    if (valid(b[column])) start = time
    else {
      intervals.push([start!, time])
      start = undefined
    }
  }
  if (start !== undefined) intervals.push([start, rows.at(-1)![0]])
  return intervals
}
/** Finite eye at the RFC sampling instant; interval intersections use every native threshold crossing. */
export function measureEye(rows: WaveformRows, column: number, bits: string, ui: number, offset: number,
  start: number, vih: number, vil: number, captures?: Capture[], period?: number): EyeMeasurement {
  const anchors: { time: number; high: boolean }[] = []
  const end = rows.at(-1)![0]
  if (captures) {
    for (const capture of captures) if (capture.time - ui >= start && capture.time + ui <= end * (1 + 1e-12)) anchors.push({ time: capture.time - ui, high: capture.high })
  } else {
    const first = Math.ceil((start - offset) / ui - 1e-10)
    for (let bit = first; offset + (bit + 2) * ui <= end * (1 + 1e-12) && (period === undefined || (bit - first) * ui < period * (1 - 1e-12)); bit++) anchors.push({ time: offset + bit * ui, high: bits[bit % bits.length] === '1' })
  }
  if (!anchors.some(a => a.high) || !anchors.some(a => !a.high)) throw new Error('recording needs complete eye windows and transmitted high and low bits after settling.')
  const sample = captures ? ui : .5 * ui
  let high = Infinity
  let low = -Infinity
  let left = 0
  let right = 2 * ui
  const intervals = [validIntervals(rows, column, false, vil), validIntervals(rows, column, true, vih)]
  const traces = anchors.map(anchor => {
    const value = sampleVoltage(rows, column, anchor.time + sample)
    if (anchor.high) high = Math.min(high, value)
    else low = Math.max(low, value)
    const valid = intervals[Number(anchor.high)]
    const interval = valid.find(([a, b]) => a <= anchor.time + sample && b >= anchor.time + sample)
    if (!interval) right = left
    else {
      left = Math.max(left, interval[0] - anchor.time)
      right = Math.min(right, interval[1] - anchor.time)
    }
    // Include native threshold boundaries, so the rendered fold preserves short invalid excursions.
    const times = new Set(Array.from({ length: 401 }, (_, i) => 2 * ui * i / 400))
    times.add(sample)
    for (const list of intervals) for (const interval of list) for (const boundary of interval) if (boundary > anchor.time && boundary < anchor.time + 2 * ui) times.add(boundary - anchor.time)
    const timestamps_s = [...times].sort((a, b) => a - b)
    return { timestamps_s, voltage_levels: timestamps_s.map(phase => sampleVoltage(rows, column, anchor.time + phase)) }
  })
  return { traces, height: high - low, width: Math.max(0, right - left), margin: Math.min(high - vih, vil - low) }
}
/** Setup/hold uses the expected transmitted bit and the nearest valid interval of that bit. */
export function strobeMargins(rows: WaveformRows, column: number, captures: Capture[], vih: number, vil: number, setup: number, hold: number): { time_s: number; setup_margin_s: number; hold_margin_s: number }[] {
  const intervals = [validIntervals(rows, column, false, vil), validIntervals(rows, column, true, vih)]
  return captures.map(({ time, high }) => {
    const candidates = intervals[Number(high)]
    let selected: [number, number] | undefined
    let distance = Infinity
    for (const interval of candidates) {
      const gap = Math.max(interval[0] - time, time - interval[1], 0)
      if (gap < distance) {
        selected = interval
        distance = gap
      }
    }
    return { time_s: time, setup_margin_s: selected ? time - selected[0] - setup : -rows.at(-1)![0] - setup,
      hold_margin_s: selected ? selected[1] - time - hold : -rows.at(-1)![0] - hold }
  })
}
