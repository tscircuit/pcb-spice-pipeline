import type { GraphicsObject, Point, Viewbox } from 'graphics-debug'
import { routeBoardDrawing, routeCanvas, routeFailure, routeFrame, routeHue, routeMarks, routePane, routePortPoint, routeText, routeTones, routeView, type RoutedSections } from '../board'
import type { IbisSources } from '../buffers'
import { sha256 } from '../kernel'
import type { RoutedCapture, RouteBuffer } from './routed-types'

export interface WaveformProbe {
  name: string
  sourcePortId: string
  /** The probe sits at the driver: a dot on the board and a thinner dashed curve drawn underneath. */
  near: boolean
}

/** The receivers' input thresholds (IBIS Vinl and Vinh), drawn as the band a signal must cross cleanly. */
export interface ReceiverThreshold {
  low: number
  high: number
}

export interface WaveformState {
  board?: RoutedSections
  probes: readonly WaveformProbe[]
  capture?: RoutedCapture
  durationSeconds: number
  threshold?: ReceiverThreshold
  running: boolean
  error?: string
}

/** Typical value of an IBIS number with an optional SI suffix (`0.8`, `800m`, `1.2V`). */
function ibisNumber(text: string): number | undefined {
  const match = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([kmunp]?)/i.exec(text)
  return match ? Number(match[1]) * ({ k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[match[2].toLowerCase()] ?? 1) : undefined
}

/** Vinl/Vinh of the bound single-ended receiver models, widened across receivers; none for differential receivers or models without them. */
export function receiverThreshold(ibisSources: IbisSources, models: readonly RouteBuffer[], receivers: ReadonlySet<string>): ReceiverThreshold | undefined {
  const texts = Object.values(ibisSources).map((bytes) => (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)))
  const found: ReceiverThreshold[] = []
  for (const model of models) {
    const text = texts.find((candidate) => sha256(candidate) === model.metadata.sourceSha256)
    for (const pin of model.metadata.pins) {
      if (!receivers.has(pin.port)) continue
      if (/diff/i.test(pin.modelType)) return undefined
      const section = text?.split(/^\s*\[Model\]\s*/im).find((part) => part.split(/\s/)[0].toLowerCase() === pin.model.toLowerCase())
      /** One keyword's typical value inside this model's section. */
      const value = (name: string): number | undefined => ibisNumber(new RegExp(`^\\s*${name}\\s*=?\\s*(\\S+)`, 'im').exec(section ?? '')?.[1] ?? '')
      const [low, high] = [value('Vinl'), value('Vinh')]
      if (low !== undefined && high !== undefined) found.push({ low, high })
    }
  }
  return found.length ? { low: Math.min(...found.map((entry) => entry.low)), high: Math.max(...found.map((entry) => entry.high)) } : undefined
}

/** A round step (1, 2 or 5 × 10ⁿ) giving about `count` intervals. */
export function roundStep(range: number, count: number): number {
  const raw = Math.max(range, 1e-30) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= raw)!
}

/** Ticks as integer multiples of a round step, so labels never show floating-point noise. */
export function roundTicks(low: number, high: number, count: number): { value: number; text: string }[] {
  const step = roundStep(high - low, count)
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const first = Math.ceil(low / step - 1e-9)
  return Array.from({ length: Math.max(1, Math.floor(high / step + 1e-9) - first + 1) }, (_, i) => {
    const value = (first + i) * step
    return { value, text: (first + i === 0 ? 0 : value).toFixed(digits) }
  })
}

/** Per-bucket extremes in time order, so a narrow overshoot survives the reduction to about `limit` buckets. */
function reduce(times: readonly number[], values: readonly number[], from: number, limit: number): number[] {
  const bucket = Math.max(1, Math.ceil((times.length - from) / limit))
  const kept: number[] = []
  for (let start = from; start < times.length; start += bucket) {
    const end = Math.min(times.length, start + bucket)
    let low = start
    let high = start
    for (let j = start + 1; j < end; j++) {
      if (values[j] < values[low]) low = j
      if (values[j] > values[high]) high = j
    }
    kept.push(...[...new Set([start, low, high, end - 1])].sort((a, b) => a - b))
  }
  return kept
}

/** Lowest and highest of many samples, without spreading them onto the call stack. */
function extent(values: readonly number[]): [number, number] {
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  return [low, high]
}

/** How far a curve leaves the common 5–95 % band, above or below. */
function excursion(levels: readonly number[], low: number, high: number): number {
  const [least, most] = extent(levels)
  return Math.max(most - high, low - least)
}

/**
 * Probe marks on the board and a waveform pane beside it.
 * Long captures fold into a two-UI eye; short ones start just before the first activity. Above six far-end probes,
 * an envelope and the worst curve replace the rainbow. IBIS receiver thresholds are a band; amber hatching means ngspice is running.
 */
export function routeWaveformDrawing(state: WaveformState): GraphicsObject {
  const { board, probes, capture, durationSeconds } = state
  const view = board && routeView(board.circuitJson, board.scope)
  const frame = view ?? routeFrame({ minX: 0, maxX: 100, minY: 0, maxY: 40 })
  const drawing = board ? routeBoardDrawing(board.circuitJson, board.scope) : routeCanvas(frame)
  const styles = probes.map((probe, i) => {
    const net = view?.ports.get(probe.sourcePortId)
    return { color: net?.color ?? routeHue(195 + (i * 360) / probes.length), label: net?.label ?? probe.name, unitInterval: net?.unitInterval, differential: Boolean(net?.differential) }
  })
  // Single-ended input thresholds mean nothing for a differential receiver.
  const threshold = probes.some((probe, i) => !probe.near && !styles[i].differential) ? state.threshold : undefined
  if (board) {
    const marks = probes.flatMap((probe, i) => {
      const point = routePortPoint(board.circuitJson, probe.sourcePortId)
      return point ? [{ point, color: styles[i].color, driver: probe.near, label: styles[i].label }] : []
    })
    routeMarks(drawing, marks, frame.unit)
  }
  const pane = frame.pane
  routePane(drawing, pane, state.error ? routeTones.failure : undefined)
  if (state.error) routeFailure(drawing, pane, state.error)
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const plot: Viewbox = { minX: pane.minX + unit * 10, maxX: pane.maxX - unit * 3, minY: pane.minY + unit * 8, maxY: pane.maxY - unit * (state.error ? 14 : 4) }
  const size = unit * 2.6
  const times = capture?.timestampsSeconds ?? []
  const series = capture?.probes.map((entry) => ({ entry, index: probes.findIndex((probe) => probe.name === entry.name) })) ?? []
  const far = series.filter(({ index }) => !probes[index]?.near)
  const unitInterval = Math.min(...styles.flatMap((style) => (style.unitInterval ? [style.unitInterval] : [])))
  const eye = Boolean(capture) && Number.isFinite(unitInterval) && durationSeconds / unitInterval >= 8
  const [least, most] = extent(series.flatMap(({ entry }) => entry.voltageLevels))
  const swing = most - least
  const active = times.findIndex((_, j) => series.some(({ entry }) => Math.abs(entry.voltageLevels[j] - entry.voltageLevels[0]) > swing * 0.05))
  const start = eye || active < 0 ? 0 : Math.max(0, times[active] - (durationSeconds - times[active]) * 0.08)
  const from = Math.max(0, times.findIndex((time) => time >= start))
  const shown = series.flatMap(({ entry }) => entry.voltageLevels.slice(from))
  // Before samples exist, the axes span ground to well above any threshold so the band reads as a band.
  const bounds = [...shown, ...(threshold ? [threshold.low, threshold.high] : []), ...(shown.length ? [] : [0, Math.max(1, (threshold?.high ?? 0) * 1.8)])]
  const [lowest, highest] = bounds.length ? extent(bounds) : [0, 1]
  const levels = roundTicks(lowest, highest, 5)
  const bottom = Math.min(levels[0].value, lowest)
  const top = Math.max(levels.at(-1)!.value, highest, bottom + 1e-9)
  /** Volts to the plot, bottom to top. */
  const y = (voltage: number): number => plot.minY + ((voltage - bottom) / (top - bottom)) * (plot.maxY - plot.minY)
  /** Seconds, or unit intervals in an eye, to the plot. */
  const x = (value: number): number => plot.minX + ((value - (eye ? 0 : start)) / (eye ? 2 : Math.max(durationSeconds - start, 1e-30))) * (plot.maxX - plot.minX)
  for (const level of levels) {
    drawing.lines!.push({ points: [{ x: plot.minX, y: y(level.value) }, { x: plot.maxX, y: y(level.value) }], strokeColor: level.value === 0 ? routeTones.quiet : routeTones.paneEdge, strokeWidth: unit * 0.15 })
    routeText(drawing, plot.minX - unit * 1.2, y(level.value), `${level.text} V`, routeTones.quiet, size, 'center_right')
  }
  if (eye)
    for (const tick of [0, 1, 2]) {
      drawing.lines!.push({ points: [{ x: x(tick), y: plot.minY }, { x: x(tick), y: plot.maxY }], strokeColor: routeTones.paneEdge, strokeWidth: unit * 0.15 })
      routeText(drawing, x(tick), plot.minY - unit * 1.5, tick ? `${tick} UI` : '0', routeTones.quiet, size, 'top_center')
    }
  else {
    const [scale, name] = ([[1, 's'], [1e3, 'ms'], [1e6, 'µs'], [1e9, 'ns'], [1e12, 'ps']] as const).find(([scale]) => durationSeconds * scale >= 1) ?? [1e12, 'ps']
    for (const tick of roundTicks(start * scale, durationSeconds * scale, 5)) {
      drawing.lines!.push({ points: [{ x: x(tick.value / scale), y: plot.minY }, { x: x(tick.value / scale), y: plot.minY - unit }], strokeColor: routeTones.quiet, strokeWidth: unit * 0.15 })
      routeText(drawing, x(tick.value / scale), plot.minY - unit * 1.5, `${tick.text} ${name}`, routeTones.quiet, size, 'top_center')
    }
  }
  if (threshold) {
    const [low, high] = [y(threshold.low), y(threshold.high)]
    drawing.lines!.push({ points: [{ x: plot.minX, y: (low + high) / 2 }, { x: plot.maxX, y: (low + high) / 2 }], strokeColor: routeTones.threshold, strokeWidth: high - low, zIndex: -0.5, label: 'receiver threshold' })
  }
  if (state.running && !capture)
    for (let i = 1; i < 16; i++) {
      const offset = ((plot.maxX - plot.minX) * i) / 16
      drawing.lines!.push({ points: [{ x: plot.minX + offset, y: plot.minY }, { x: Math.min(plot.maxX, plot.minX + offset + (plot.maxY - plot.minY) * 0.5), y: plot.maxY }], strokeColor: 'rgba(251, 191, 36, 0.3)', strokeWidth: unit * 0.5 })
    }
  if (!capture) return drawing
  /** One probe's curve, cut at every fold of the eye. */
  const curve = (curveLevels: readonly number[], period: number): Point[][] => {
    if (!eye) return [reduce(times, curveLevels, from, 700).map((j) => ({ x: x(times[j]), y: y(curveLevels[j]) }))]
    const middle = extent(curveLevels).reduce((a, b) => a + b) / 2
    const crossing = curveLevels.findIndex((value, j) => j > 0 && (curveLevels[j - 1] - middle) * (value - middle) < 0)
    const origin = (crossing > 0 ? times[crossing] : 0) - period / 2
    const runs: Point[][] = [[]]
    let last = -1
    for (const j of reduce(times, curveLevels, 0, 2500)) {
      const phase = ((((times[j] - origin) / period) % 2) + 2) % 2
      if (phase < last) runs.push([])
      runs.at(-1)!.push({ x: x(phase), y: y(curveLevels[j]) })
      last = phase
    }
    return runs.filter((run) => run.length > 1)
  }
  if (far.length > 6 && !eye) {
    // A grey envelope of every far-end probe under the one curve that leaves the common band the most.
    const columns = Array.from({ length: 300 }, () => [Infinity, -Infinity])
    for (let j = from; j < times.length; j++) {
      const column = columns[Math.min(299, Math.floor(((times[j] - start) / Math.max(durationSeconds - start, 1e-30)) * 300))]
      for (const { entry } of far) column.splice(0, 2, Math.min(column[0], entry.voltageLevels[j]), Math.max(column[1], entry.voltageLevels[j]))
    }
    for (const [i, [low, high]] of columns.entries())
      if (high >= low) drawing.lines!.push({ points: [{ x: x(start + ((i + 0.5) * (durationSeconds - start)) / 300), y: y(low) }, { x: x(start + ((i + 0.5) * (durationSeconds - start)) / 300), y: y(high) + unit * 0.05 }], strokeColor: routeTones.envelope, strokeWidth: ((plot.maxX - plot.minX) / 300) * 1.05, zIndex: -0.4 })
    const all = far.flatMap(({ entry }) => entry.voltageLevels.slice(from)).sort((a, b) => a - b)
    const [low, high] = [all[Math.floor(all.length * 0.05)], all[Math.floor(all.length * 0.95)]]
    const worst = far.reduce((a, b) => (excursion(b.entry.voltageLevels.slice(from), low, high) > excursion(a.entry.voltageLevels.slice(from), low, high) ? b : a))
    const style = styles[worst.index] ?? styles[0]
    for (const points of curve(worst.entry.voltageLevels, unitInterval)) drawing.lines!.push({ points, strokeColor: style.color, strokeWidth: unit * 0.35, label: style.label, layer: 'waveform' })
    return drawing
  }
  for (const { entry, index } of [...series].sort((a, b) => Number(!probes[a.index]?.near) - Number(!probes[b.index]?.near))) {
    const style = styles[index] ?? { color: routeHue(0), label: entry.name, unitInterval: undefined, differential: false }
    const near = Boolean(probes[index]?.near)
    for (const points of curve(entry.voltageLevels, style.unitInterval ?? unitInterval))
      drawing.lines!.push({ points, strokeColor: style.color, strokeWidth: unit * (near ? 0.18 : 0.3), strokeDash: near ? '6 4' : undefined, label: style.label, layer: 'waveform' })
  }
  return drawing
}
