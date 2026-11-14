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
