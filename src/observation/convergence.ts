import { sampleVoltage, quietPeak } from './measure'
import type { WaveformRows } from './types'

/** Compare each probe on the union of native adaptive times, preserving every narrow excursion. */
export function waveformConvergence(before: WaveformRows, after: WaveformRows, gate: number, idle: number[]): { accepted: boolean; probes: { column: number; samples: number; rms_v: number; scale_v: number; peak_change_v: number; positive_v: number; negative_v: number; accepted: boolean }[] } {
  const probes = idle.map((baseline, index) => {
    const column = index + 1
    let a = 0
    let b = 0
    let previous = gate
    let squared = 0
    let samples = 0
    let minimum = Infinity
    let maximum = -Infinity
    /** Linear value with a monotone cursor, avoiding binary searches on the dense union grid. */
    const value = (rows: WaveformRows, position: number, time: number): number => {
      const left = rows[position]
      const right = rows[Math.min(position + 1, rows.length - 1)]
      return right[0] === left[0] ? left[column] : left[column] + (right[column] - left[column]) * (time - left[0]) / (right[0] - left[0])
    }
    while (a + 1 < before.length && before[a + 1][0] <= gate) a++
    while (b + 1 < after.length && after[b + 1][0] <= gate) b++
    let error = sampleVoltage(after, column, gate) - sampleVoltage(before, column, gate)
    const end = Math.min(before.at(-1)![0], after.at(-1)![0])
    while (previous < end) {
      const time = Math.min(before[a + 1]?.[0] ?? end, after[b + 1]?.[0] ?? end, end)
      const x = value(before, a, time)
      const y = value(after, b, time)
      const next = y - x
      // Exact integral of the squared piecewise linear difference.
      squared += (time - previous) * (error * error + error * next + next * next) / 3
      minimum = Math.min(minimum, x, y)
      maximum = Math.max(maximum, x, y)
      samples++
      if (a + 1 < before.length && before[a + 1][0] <= time) a++
      if (b + 1 < after.length && after[b + 1][0] <= time) b++
      previous = time
      error = next
    }
    const first = quietPeak(before, column, gate, baseline)
    const last = quietPeak(after, column, gate, baseline)
    const change = Math.max(Math.abs(last.peak_positive_v - first.peak_positive_v), Math.abs(last.peak_negative_v - first.peak_negative_v))
    const peakScale = Math.max(last.peak_positive_v, -last.peak_negative_v)
    const rms = Math.sqrt(squared / (end - gate))
    const scale = maximum - minimum
    return { column, samples, rms_v: rms, scale_v: scale, peak_change_v: change, positive_v: last.peak_positive_v, negative_v: last.peak_negative_v,
      accepted: rms <= .001 + .01 * scale && change <= .001 + .01 * peakScale }
  })
  return { accepted: probes.every(p => p.accepted), probes }
}
