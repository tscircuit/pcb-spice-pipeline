import type { GraphicsObject, Point } from 'graphics-debug'
import {
  routeBoardDrawing, routeBounds, routeColor, routeDrawingUnit, routeMarks, routePane, routePaneBox, routePortPoint, routeSourceColor, routeSources, routeText, routeTones, routeUnit,
  type RoutedSections,
} from '../board'
import type { RoutedCapture } from './routed-types'

export interface WaveformProbe {
  name: string
  sourcePortId: string
  /** The probe sits at the driver: drawn as a dot on the board and dashed in the plot. */
  near: boolean
}

/** A round axis step (1, 2 or 5 times a power of ten) giving about `count` intervals. */
export function roundStep(range: number, count: number): number {
  const raw = Math.max(range, 1e-30) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= raw)!
}

/** The probes' board, probe marks in their net's colour, and their waveforms in a pane beside it; no samples leaves the axes empty. */
export function routeWaveformDrawing(board: RoutedSections | undefined, probes: readonly WaveformProbe[], capture: RoutedCapture | undefined, durationSeconds: number, error?: string): GraphicsObject {
  const drawing: GraphicsObject = board ? routeBoardDrawing(board.circuitJson, board.scope) : { coordinateSystem: 'cartesian', lines: [], polygons: [], circles: [], rects: [], texts: [] }
  const sources = board ? routeSources(board.circuitJson, board.scope) : []
  const colors = probes.map((probe, i) => {
    const trace = board?.circuitJson.find((record) => record.type === 'source_trace' && record.connected_source_port_ids.includes(probe.sourcePortId))
    return trace?.type === 'source_trace' && sources.includes(trace.source_trace_id) ? routeSourceColor(sources, trace.source_trace_id) : routeColor(i, probes.length)
  })
  if (board)
    routeMarks(
      drawing,
      probes.flatMap((probe, i) => {
        const point = routePortPoint(board.circuitJson, probe.sourcePortId)
        return point ? [{ point, color: colors[i], driver: probe.near }] : []
      }),
      routeDrawingUnit(drawing, board.circuitJson),
    )
  const focus = routeBounds(drawing.lines!.flatMap((line) => line.points)) ?? { minX: 0, maxX: 100, minY: 0, maxY: 40 }
  const pane = routePaneBox(focus, 2.4)
  routePane(drawing, pane, error ? routeTones.failure : undefined)
  const unit = routeUnit(pane)
  if (error) routeText(drawing, pane.minX + unit * 2, pane.maxY - unit * 2.5, error.length > 90 ? `${error.slice(0, 87)}…` : error, routeTones.failure, unit * 2.2, 'center_left')
  const plot = { minX: pane.minX + unit * 11, maxX: pane.maxX - unit * 4, minY: pane.minY + unit * 9, maxY: pane.maxY - unit * 6 }
  const levels = capture?.probes.flatMap((probe) => probe.voltageLevels) ?? []
  let min = levels.reduce((low, value) => Math.min(low, value), Infinity)
  let max = levels.reduce((high, value) => Math.max(high, value), -Infinity)
  if (!(max > min)) [min, max] = Number.isFinite(min) ? [min - 0.5, min + 0.5] : [0, 1]
  const voltageStep = roundStep(max - min, 4)
  const bottom = Math.floor(min / voltageStep) * voltageStep
  const top = Math.ceil(max / voltageStep) * voltageStep
  /** Volts to the plot, bottom to top. */
  const y = (voltage: number): number => plot.minY + ((voltage - bottom) / (top - bottom)) * (plot.maxY - plot.minY)
  /** Seconds from zero to the declared duration. */
  const x = (time: number): number => plot.minX + (time / Math.max(durationSeconds, 1e-30)) * (plot.maxX - plot.minX)
  const size = unit * 2.2
  for (let voltage = bottom; voltage <= top + voltageStep / 2; voltage += voltageStep) {
    drawing.lines!.push({ points: [{ x: plot.minX, y: y(voltage) }, { x: plot.maxX, y: y(voltage) }], strokeColor: Math.abs(voltage) < voltageStep / 2 ? routeTones.quiet : routeTones.paneEdge, strokeWidth: unit * 0.15 })
    routeText(drawing, plot.minX - unit * 1.5, y(voltage), `${Number(voltage.toPrecision(3))} V`, routeTones.quiet, size, 'center_right')
  }
  const timeStep = roundStep(durationSeconds, 5)
  const [scale, name] = ([[1, 's'], [1e3, 'ms'], [1e6, 'µs'], [1e9, 'ns'], [1e12, 'ps']] as const).find(([scale]) => durationSeconds * scale >= 1) ?? [1e12, 'ps']
  for (let time = 0; time <= durationSeconds * (1 + 1e-9); time += timeStep) {
    drawing.lines!.push({ points: [{ x: x(time), y: plot.minY }, { x: x(time), y: plot.minY - unit }], strokeColor: routeTones.quiet, strokeWidth: unit * 0.15 })
    routeText(drawing, x(time), plot.minY - unit * 2, `${Number((time * scale).toPrecision(3))} ${name}`, routeTones.quiet, size, 'top_center')
  }
  if (!capture) return drawing
  const alpha = capture.probes.length > 6 ? 0.7 : 1
  for (const [i, probe] of capture.probes.entries()) {
    const points: Point[] = []
    const times = capture.timestampsSeconds
    const bucket = Math.max(1, Math.ceil(times.length / 600))
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
    const index = probes.findIndex((entry) => entry.name === probe.name)
    const color = colors[index] ?? routeColor(i, capture.probes.length)
    drawing.lines!.push({ points, strokeColor: alpha < 1 ? color.replace(/, 1\)$/, `, ${alpha})`) : color, strokeWidth: unit * 0.3, strokeDash: probes[index]?.near ? '6 4' : undefined, label: probe.name })
  }
  return drawing
}
