import type { WaveformRows } from './types'

/** Interpolate an actual adaptive solver trace at a bounded time. */
export function sampleVoltage(rows: WaveformRows, column: number, time: number): number {
  if (time < rows[0][0] || time > rows.at(-1)![0]) throw new Error('Measurement time is outside the recording')
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
/** Peak noise about the time-weighted DC baseline, after the settling gate. */
export function quietPeak(rows: WaveformRows, column: number, start: number): number {
  const points = [[start, sampleVoltage(rows, column, start)], ...rows.filter(row => row[0] > start).map(row => [row[0], row[column]])]
  let area = 0
  for (let i = 1; i < points.length; i++) area += (points[i][0] - points[i - 1][0]) * (points[i][1] + points[i - 1][1]) / 2
  const baseline = area / (points.at(-1)![0] - start)
  return points.reduce((peak, point) => Math.max(peak, Math.abs(point[1] - baseline)), 0)
}
export interface EyeMeasurement {
  traces: number[][][]; height: number; width: number; margin: number
}
/** Finite observed eye: known transmitted bits, inner envelopes, threshold-qualified width. */
export function measureEye(rows: WaveformRows, column: number, bits: string, ui: number, offset: number,
  start: number, vih: number, vil: number, captures?: number[]): EyeMeasurement {
  const points = 400
  const anchors: { time: number; high: boolean }[] = []
  if (captures) {
    for (const time of captures) if (time - ui >= start && time + ui <= rows.at(-1)![0]) anchors.push({ time: time - ui, high: sampleVoltage(rows, column, time) >= (vih + vil) / 2 })
  } else {
    for (let bit = Math.ceil((start - offset) / ui); offset + (bit + 2) * ui <= rows.at(-1)![0]; bit++) anchors.push({ time: offset + bit * ui, high: bits[bit % bits.length] === '1' })
  }
  if (!anchors.some(a => a.high) || !anchors.some(a => !a.high)) throw new Error('Eye requires observed high and low bits after 16 UI settling')
  const traces = anchors.map(() => [] as number[][])
  let height = -Infinity
  let margin = -Infinity
  let run = 0
  let width = 0
  for (let index = 0; index <= points; index++) {
    const phase = 2 * ui * index / points
    let high = Infinity
    let low = -Infinity
    for (const [i, anchor] of anchors.entries()) {
      const value = sampleVoltage(rows, column, anchor.time + phase)
      traces[i].push([phase, value])
      if (anchor.high) high = Math.min(high, value)
      else low = Math.max(low, value)
    }
    height = Math.max(height, high - low)
    margin = Math.max(margin, Math.min(high - vih, vil - low))
    run = high >= vih && low <= vil ? run + 1 : 0
    width = Math.max(width, Math.max(0, run - 1) * 2 * ui / points)
  }
  return { traces, height, width: Math.min(ui, width), margin }
}
/** Setup/hold from the continuous threshold-valid interval around each received strobe edge. */
export function strobeMargins(rows: WaveformRows, column: number, captures: number[], vih: number, vil: number, setup: number, hold: number): { time_s: number; setup_margin_s: number; hold_margin_s: number }[] {
  return captures.map(time => {
    const value = sampleVoltage(rows, column, time)
    const valid = value >= vih || value <= vil
    const threshold = value >= (vih + vil) / 2 ? vih : vil
    const crossings = crossingTimes(rows, column, threshold, rows[0][0])
    const before = crossings.filter(t => t <= time).at(-1) ?? rows[0][0]
    const after = crossings.find(t => t > time) ?? rows.at(-1)![0]
    return { time_s: time, setup_margin_s: (valid ? time - before : 0) - setup, hold_margin_s: (valid ? after - time : 0) - hold }
  })
}
