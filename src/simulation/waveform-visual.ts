import type { GraphicsObject, Point } from 'graphics-debug'
import { routeText, routeTextSize } from '../board'
import type { RoutedCapture } from './routed-types'

/** Pure atlas drawing for the live async transient solver. */
export function routeWaveformDrawing(capture: RoutedCapture | undefined, durationSeconds: number, error?: string): GraphicsObject {
  const drawing: GraphicsObject = { coordinateSystem: 'cartesian', lines: [], texts: [] }
  routeText(
    drawing,
    2,
    178,
    error ? `Transient failed: ${error}` : capture?.kind === 'completed' ? '5 · Transient: ngspice samples · candidate-unqualified' : '5 · Transient: awaiting live ngspice',
    error ? '#dc2626' : '#a16207',
    routeTextSize.title,
  )
  let min = -0.4
  let max = 1.9
  if (capture?.kind === 'completed')
    for (const probe of capture.probes)
      for (const value of probe.voltageLevels) {
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
  const margin = (max - min) * 0.08
  /** Map voltage to the fixed waveform panel with headroom above both limits. */
  const y = (voltage: number): number => 118 + ((voltage - min + margin) / (max - min + margin * 2)) * 40
  /** Time is always plotted from zero, using the declared recording duration. */
  const x = (time: number): number => 14 + (time / Math.max(durationSeconds, 1e-30)) * 278
  drawing.lines!.push({
    points: [
      { x: 14, y: 158 },
      { x: 14, y: 118 },
      { x: 292, y: 118 },
    ],
    strokeColor: '#64748b',
    strokeWidth: 0.2,
  })
  for (const voltage of [-0.4, 0, 1, 1.9]) {
    drawing.lines!.push({
      points: [
        { x: 14, y: y(voltage) },
        { x: 292, y: y(voltage) },
      ],
      strokeColor: voltage === -0.4 || voltage === 1.9 ? '#dc2626' : '#e2e8f0',
      strokeDash: '1 1',
      strokeWidth: 0.15,
      label: `${voltage} V`,
    })
    routeText(drawing, 2, y(voltage), `${voltage} V`, voltage === -0.4 || voltage === 1.9 ? '#dc2626' : '#64748b')
  }
  for (let i = 0; i <= 4; i++) {
    const time = (durationSeconds * i) / 4
    drawing.lines!.push({
      points: [
        { x: x(time), y: 118 },
        { x: x(time), y: 117 },
      ],
      strokeColor: '#64748b',
      strokeWidth: 0.15,
    })
    routeText(drawing, x(time) - 1, 113, `${(time * 1e9).toFixed(2)}`, '#64748b')
  }
  routeText(drawing, 2, 164, 'Voltage (V) · Red dashed: 1.9 V / −0.4 V limits', '#475569')
  routeText(drawing, 140, 108, 'Time (ns)', '#475569')
  if (capture?.kind !== 'completed') {
    routeText(drawing, 65, 140, error ? 'No completed ngspice result' : 'Awaiting live ngspice — no waveform data', '#a16207')
    return drawing
  }
  for (const [i, probe] of capture.probes.entries()) {
    const color = /victim/i.test(probe.name) ? '#9333ea' : ['#2563eb', '#0891b2', '#16a34a', '#ea580c'][i % 4]
    const points: Point[] = []
    const times = capture.timestampsSeconds
    const bucket = Math.max(1, Math.ceil(times.length / 400))
    // Keep each bucket's extrema in time order so a narrow overshoot is not hidden.
    for (let start = 0; start < times.length; start += bucket) {
      const end = Math.min(times.length, start + bucket)
      let low = start
      let high = start
      for (let j = start + 1; j < end; j++) {
        if (probe.voltageLevels[j] < probe.voltageLevels[low]) low = j
        if (probe.voltageLevels[j] > probe.voltageLevels[high]) high = j
      }
      for (const j of [...new Set([start, low, high, end - 1])].sort((a, b) => a - b)) points.push({ x: x(times[j]), y: y(probe.voltageLevels[j]) })
    }
    drawing.lines!.push({ points, strokeColor: color, strokeWidth: 0.3, label: probe.name })
    if (i < 6) routeText(drawing, 14 + i * 46, 172, probe.name.slice(0, 24), color)
  }
  if (capture.probes.length > 6) routeText(drawing, 146, 108, `${capture.probes.length} probes; first 6 labelled`, '#64748b')
  return drawing
}
