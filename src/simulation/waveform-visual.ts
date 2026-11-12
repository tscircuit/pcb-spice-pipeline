import type { GraphicsObject, Point, Viewbox } from 'graphics-debug'
import { routeNetColors, routeText, routeTextSize } from '../board'
import type { IbisSources } from '../buffers'
import { sha256 } from '../kernel'
import type { RoutedCapture, RouteBuffer } from './routed-types'

/** A horizontal limit line, e.g. a receiver's input threshold. */
export interface RouteLimit {
  voltage: number
  label: string
}

/** Typical value of an IBIS number with an optional SI suffix (`0.8`, `800m`, `1.2V`). */
function ibisNumber(text: string): number | undefined {
  const match = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([kmunp]?)/i.exec(text)
  if (!match) return undefined
  return Number(match[1]) * ({ k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[match[2].toLowerCase()] ?? 1)
}

/** Receiver Vinl / Vinh from the bound IBIS models of every port that is not driven; empty when the models declare none. */
export function routeReceiverLimits(ibisSources: IbisSources, models: readonly RouteBuffer[], drivenSourcePortIds: readonly string[]): RouteLimit[] {
  const texts = Object.values(ibisSources).map((bytes) => (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)))
  const limits = new Map<string, RouteLimit>()
  for (const model of models) {
    const text = texts.find((candidate) => sha256(candidate) === model.metadata.sourceSha256)
    if (!text) continue
    for (const pin of model.metadata.pins) {
      if (drivenSourcePortIds.includes(pin.port) || !/input|i\/o/i.test(pin.modelType)) continue
      const section = text.split(/^\s*\[Model\]\s*/im).find((part) => part.split(/\s/)[0].toLowerCase() === pin.model.toLowerCase())
      for (const [, name, value] of section?.matchAll(/^\s*(Vin[lh])\s*=?\s*(\S+)/gim) ?? []) {
        const voltage = ibisNumber(value)
        if (voltage === undefined) continue
        const label = `${name[0].toUpperCase()}${name.slice(1).toLowerCase()} ${Number(voltage.toPrecision(3))} V`
        limits.set(label, { voltage, label })
      }
    }
  }
  return [...limits.values()].sort((a, b) => a.voltage - b.voltage)
}

/** Round step for about `count` ticks over a span: 1, 2 or 5 × 10ⁿ. */
export function routeTickStep(span: number, count: number): number {
  const raw = Math.max(span, 1e-30) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= raw)!
}

/** SI prefix that keeps `value` between 1 and 1000. */
export function routeUnitScale(value: number): { scale: number; prefix: string } {
  const prefixes: [number, string][] = [
    [1, ''],
    [1e3, 'm'],
    [1e6, 'µ'],
    [1e9, 'n'],
    [1e12, 'p'],
    [1e15, 'f'],
  ]
  return (([scale, prefix]) => ({ scale, prefix }))(prefixes.find(([scale]) => Math.abs(value) * scale >= 1) ?? prefixes.at(-1)!)
}

/** Pure waveform panel inside `box`: probe curves, auto-scaled voltage and time ticks, dashed red limits. */
export function routeWaveformDrawing(
  capture: RoutedCapture | undefined,
  durationSeconds: number,
  box: Viewbox,
  options: { error?: string; limits?: readonly RouteLimit[]; colors?: readonly string[]; textSize?: number } = {},
): GraphicsObject {
  const drawing: GraphicsObject = { coordinateSystem: 'cartesian', lines: [], texts: [] }
  const size = options.textSize ?? routeTextSize(box).body
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  const left = box.minX + width * 0.08
  const right = box.maxX - width * 0.08
  const bottom = box.minY + height * 0.14
  const top = box.maxY - height * 0.16
  const limits = options.limits ?? []
  const values = [...limits.map((limit) => limit.voltage), ...(capture?.kind === 'completed' ? capture.probes.flatMap((probe) => probe.voltageLevels) : [])].filter(Number.isFinite)
  let min = values.length ? values.reduce((a, b) => Math.min(a, b)) : 0
  let max = values.length ? values.reduce((a, b) => Math.max(a, b)) : 1
  if (max - min < 1e-12) [min, max] = [min - 0.5, max + 0.5]
  const volts = routeUnitScale(Math.max(Math.abs(min), Math.abs(max)))
  const step = routeTickStep(max - min, 5)
  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step
  /** Voltage to panel y. */
  const y = (voltage: number): number => bottom + ((voltage - low) / (high - low)) * (top - bottom)
  /** Time from zero over the declared recording duration. */
  const x = (time: number): number => left + (time / Math.max(durationSeconds, 1e-30)) * (right - left)
  const stroke = height * 0.004
  drawing.lines!.push({ points: [{ x: left, y: top }, { x: left, y: bottom }, { x: right, y: bottom }], strokeColor: '#64748b', strokeWidth: stroke })
  for (let i = 0; low + i * step <= high + step * 1e-6; i++) {
    const voltage = low + i * step
    drawing.lines!.push({ points: [{ x: left, y: y(voltage) }, { x: right, y: y(voltage) }], strokeColor: '#e2e8f0', strokeWidth: stroke })
    routeText(drawing, left - size * 0.3, y(voltage), `${Number((voltage * volts.scale).toPrecision(4))} ${volts.prefix}V`, '#64748b', size)
    drawing.texts!.at(-1)!.anchorSide = 'center_right'
  }
  for (const limit of limits) {
    drawing.lines!.push({ points: [{ x: left, y: y(limit.voltage) }, { x: right, y: y(limit.voltage) }], strokeColor: '#dc2626', strokeDash: [stroke * 4, stroke * 4], strokeWidth: stroke, label: limit.label })
    routeText(drawing, right + size * 0.3, y(limit.voltage), limit.label, '#dc2626', size)
  }
  const time = routeUnitScale(durationSeconds)
  for (let i = 0; i <= 4; i++) {
    const at = (durationSeconds * i) / 4
    drawing.lines!.push({ points: [{ x: x(at), y: bottom }, { x: x(at), y: bottom - size * 0.3 }], strokeColor: '#64748b', strokeWidth: stroke })
    drawing.texts!.push({ x: x(at), y: bottom - size * 0.5, text: `${Number((at * time.scale).toPrecision(4))}${i === 4 ? ` ${time.prefix}s` : ''}`, color: '#64748b', fontSize: size, anchorSide: 'top_center' })
  }
  if (capture?.kind !== 'completed') {
    routeText(drawing, left + size, (top + bottom) / 2, options.error ? `Failed: ${options.error}` : 'Awaiting ngspice', options.error ? '#dc2626' : '#a16207', size)
    return drawing
  }
  for (const [i, probe] of capture.probes.entries()) {
    const color = options.colors?.[i] ?? routeNetColors[i % routeNetColors.length]
    const points: Point[] = []
    const times = capture.timestampsSeconds
    const bucket = Math.max(1, Math.ceil(times.length / 400))
    // Keep each bucket's extrema in time order so a narrow overshoot is not hidden.
    for (let start = 0; start < times.length; start += bucket) {
      const end = Math.min(times.length, start + bucket)
      let lowest = start
      let highest = start
      for (let j = start + 1; j < end; j++) {
        if (probe.voltageLevels[j] < probe.voltageLevels[lowest]) lowest = j
        if (probe.voltageLevels[j] > probe.voltageLevels[highest]) highest = j
      }
      for (const j of [...new Set([start, lowest, highest, end - 1])].sort((a, b) => a - b)) points.push({ x: x(times[j]), y: y(probe.voltageLevels[j]) })
    }
    // A second probe on the same net shares its colour; dashes tell them apart.
    const repeat = options.colors?.slice(0, i).includes(color)
    drawing.lines!.push({ points, strokeColor: color, strokeWidth: stroke * 2, strokeDash: repeat ? [stroke * 6, stroke * 3] : undefined, label: probe.name, zIndex: 2 })
    if (i < 6) routeText(drawing, left + ((i % 3) * (right - left)) / 3, top + size * (0.9 + Math.floor(i / 3) * 1.3), `${repeat ? '- - ' : ''}${probe.name.slice(0, 32)}`, color, size)
  }
  return drawing
}
