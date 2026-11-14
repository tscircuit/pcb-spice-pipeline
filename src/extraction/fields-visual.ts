import type { GraphicsObject, Point, Viewbox } from 'graphics-debug'
import {
  routeBounds, routeCanvas, routeDisplayItems, routeFailure, routeFrame, routeNets, routePane, routeStroke, routeText, routeTones, routeView,
  routePosition, type CircuitJson, type CopperScope, type RouteSlice, type SectionGeometry,
} from '../board'
import type { CrossSection } from './cross-section-types'
import type { ExtractedRouteSlice, RouteCoefficients, RouteMaterials } from './route-lines'

/** Characteristic impedance of conductor `i` from its self terms. */
export function sliceImpedance(line: RouteCoefficients, i: number): number {
  return Math.sqrt(line.L[i][i] / line.C[i][i])
}

/** A three-stop scale (sky, lime, orange) from the lowest to the highest impedance on the board. */
export function impedanceColor(value: number, low: number, high: number): string {
  const t = high > low ? Math.min(1, Math.max(0, (value - low) / (high - low))) : 0.5
  const stops = [[56, 189, 248], [163, 230, 53], [251, 146, 60]]
  const [a, b] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]]
  const u = t < 0.5 ? t * 2 : t * 2 - 1
  return `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * u)).join(', ')})`
}

export interface FieldsState {
  geometry: SectionGeometry
  circuitJson?: CircuitJson
  scope?: CopperScope
  materials: RouteMaterials
  solved: ExtractedRouteSlice[]
  /** The slice on screen and its cross-section; when solving has finished, the most informative selected slice. */
  slice?: RouteSlice
  section?: CrossSection
  line?: RouteCoefficients
  error?: string
}

/** The selected copper coloured by solved Z0, an amber cut at the slice on screen, and its to-scale stack in the pane. */
export function fieldsDrawing(state: FieldsState): GraphicsObject {
  const { geometry, circuitJson, scope } = state
  const view = circuitJson && scope ? routeView(circuitJson, scope) : undefined
  const frame = view ?? routeFrame(routeBounds(geometry.wires.flatMap((wire) => [wire.a, wire.b].map(([x, y]) => ({ x, y })))) ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 })
  const drawing = routeCanvas(frame)
  /** Selected copper is what the map colours; without a scope every wire counts. */
  const selected = (trace: string): boolean => !view || view.traces.has(trace)
  if (view && circuitJson) routeNets(drawing, circuitJson, view, view.traces, () => routeTones.copper)
  else for (const wire of geometry.wires) drawing.lines!.push(...routeStroke([wire.a, wire.b].map(([x, y]) => ({ x, y })), routeTones.copper, wire.width, wire.layer))
  const values = state.solved.flatMap((slice) => slice.wires.flatMap((wire, i) => (selected(wire.trace) ? [sliceImpedance(slice.line, i)] : [])))
  // Never stretch a few ohms across the whole scale: it always spans at least ±10 % of the median.
  const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 50
  const low = Math.min(...values, median * 0.9)
  const high = Math.max(...values, median * 1.1)
  for (const slice of state.solved)
    for (const [i, wire] of slice.wires.entries()) {
      if (!selected(wire.trace)) continue
      const z0 = sliceImpedance(slice.line, i)
      const points = [slice.start, slice.end].map((position) => (([x, y]) => ({ x, y }))(routePosition(wire, position)))
      drawing.lines!.push(...routeStroke(points, impedanceColor(z0, low, high), wire.width, wire.layer, `${z0.toFixed(0)} Ω`))
    }
  routePane(drawing, frame.pane, state.error ? routeTones.failure : undefined)
  if (state.slice && state.section) {
    const cut = routeBounds(sliceCut(drawing, state.slice, frame.unit))!
    const from = { x: (cut.minX + cut.maxX) / 2, y: (cut.minY + cut.maxY) / 2 }
    const right = frame.pane.minX > frame.focus.maxX
    drawing.lines!.push({ points: [from, right ? { x: frame.pane.minX, y: from.y } : { x: from.x, y: frame.pane.maxY }], strokeColor: routeTones.slice, strokeWidth: frame.unit * 0.18, strokeDash: '6 4' })
    const colors = state.slice.wires.map((wire, i) => (!selected(wire.trace) ? '#56606b' : state.line ? impedanceColor(sliceImpedance(state.line, i), Math.min(low, sliceImpedance(state.line, i)), Math.max(high, sliceImpedance(state.line, i))) : (view?.sources.get(wire.source)?.color ?? routeTones.copper)))
    const labels = state.slice.wires.map((wire, i) => (state.line && selected(wire.trace) ? `${sliceImpedance(state.line, i).toFixed(0)} Ω` : undefined))
    stackPane(drawing, frame.pane, state.section, colors, labels, state.line, state.materials)
  }
  if (values.length) impedanceBar(drawing, frame.pane, low, high)
  if (state.error) routeFailure(drawing, frame.pane, state.error)
  return drawing
}

/** An amber band across the slice's conductors at its midpoint, at least a few camera units long so it reads at any zoom. */
function sliceCut(drawing: GraphicsObject, slice: RouteSlice, unit: number): Point[] {
  const middle = (slice.start + slice.end) / 2
  const reach = Math.max(...slice.wires.map((wire) => wire.width), unit * 1.2)
  const half = unit * 0.35
  const low = Math.min(...slice.wires.map((wire) => wire.transverse)) - reach
  const high = Math.max(...slice.wires.map((wire) => wire.transverse)) + reach
  const points = [[-half, low], [half, low], [half, high], [-half, high]].map(([offset, transverse]) => (([x, y]) => ({ x, y }))(routePosition({ ...slice.wires[0], transverse }, middle + offset)))
  drawing.polygons!.push({ points, fill: routeTones.slice, stroke: routeTones.halo, strokeWidth: unit * 0.08 })
  return points
}

/** The cross-section at one uniform mm scale: laminate tan, mask green, planes copper, conductors coloured, coupling bands over the top. */
function stackPane(drawing: GraphicsObject, pane: Viewbox, section: CrossSection, colors: string[], labels: (string | undefined)[], line: RouteCoefficients | undefined, materials: RouteMaterials): void {
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const inner = { minX: pane.minX + unit * 5, maxX: pane.maxX - unit * 5, minY: pane.minY + unit * 13, maxY: pane.maxY - unit * 11 }
  const zLow = Math.min(...section.dielectrics.map((d) => d.zMm), ...section.planes.map((p) => p.zMm))
  const zHigh = Math.max(...section.dielectrics.map((d) => d.zMm + d.thicknessMm), ...section.conductors.map((c) => c.zMm + c.thicknessMm), ...section.planes.map((p) => p.zMm))
  const low = Math.min(...section.conductors.map((c) => c.xMm - c.widthMm / 2))
  const high = Math.max(...section.conductors.map((c) => c.xMm + c.widthMm / 2))
  const margin = Math.max(zHigh - zLow, (high - low) * 0.3)
  const scale = Math.min((inner.maxX - inner.minX) / (high - low + 2 * margin), (inner.maxY - inner.minY) / Math.max(zHigh - zLow, 1e-3))
  const center = { x: (inner.minX + inner.maxX) / 2, y: (inner.minY + inner.maxY) / 2 }
  /** Transverse millimetres on the shared scale. */
  const x = (v: number): number => center.x + (v - (low + high) / 2) * scale
  /** Stack millimetres on the same scale, so the picture is to scale. */
  const z = (v: number): number => center.y + (v - (zLow + zHigh) / 2) * scale
  // Reference planes are infinite: the slabs run the full pane width.
  const width = inner.maxX - inner.minX
  for (const [i, slab] of [...section.dielectrics].sort((a, b) => a.zMm - b.zMm).entries()) {
    const mask = slab.er === materials.maskEr && slab.lossTangent === materials.maskLoss
    drawing.rects!.push({ center: { x: center.x, y: z(slab.zMm + slab.thicknessMm / 2) }, width, height: slab.thicknessMm * scale, fill: mask ? '#24573f' : i % 2 ? '#5e4d36' : '#53442f' })
  }
  const copper = Math.max(section.conductors[0]?.thicknessMm ?? 0.035, 1e-3) * scale
  for (const plane of section.planes) drawing.rects!.push({ center: { x: center.x, y: z(plane.zMm) }, width, height: Math.max(copper, unit * 0.3), fill: '#b08d57' })
  for (const [i, c] of section.conductors.entries())
    drawing.rects!.push({ center: { x: x(c.xMm), y: z(c.zMm + c.thicknessMm / 2) }, width: Math.max(c.widthMm * scale, unit * 0.3), height: Math.max(c.thicknessMm * scale, unit * 0.3), fill: colors[i], stroke: colors[i] })
  if (!line) return
  const top = z(zHigh)
  const pairs = section.conductors
    .flatMap((a, i) => section.conductors.slice(i + 1).map((b, offset) => {
      const j = i + offset + 1
      return { a, b, k: Math.max(Math.abs(line.C[i][j]) / Math.sqrt(line.C[i][i] * line.C[j][j]), Math.abs(line.L[i][j]) / Math.sqrt(line.L[i][i] * line.L[j][j])) }
    }))
    .filter((pair) => pair.k >= 0.005)
    .sort((p, q) => q.k - p.k)
  for (const pair of routeDisplayItems(pairs, 60)) {
    const [from, to] = [x(pair.a.xMm), x(pair.b.xMm)].sort((p, q) => p - q)
    const rise = Math.min(unit * 8, (to - from) * 0.4) + unit
    const thickness = unit * (0.3 + 3 * Math.sqrt(Math.min(pair.k, 1)))
    /** One edge of the band, offset from its center arc. */
    const arc = (offset: number): Point[] => Array.from({ length: 17 }, (_, t) => ({ x: from + ((to - from) * t) / 16, y: top + unit + (rise + offset) * Math.sin((Math.PI * t) / 16) }))
    drawing.polygons!.push({ points: [...arc(thickness / 2), ...arc(-thickness / 2).reverse()], fill: routeTones.coupling, stroke: 'none', label: `k ${pair.k.toFixed(3)}` })
  }
  const labelled = section.conductors.flatMap((c, i) => (labels[i] ? [{ c, text: labels[i]!, color: colors[i] }] : []))
  if (labelled.length > 8) return
  // Neighbouring labels closer than a label's width alternate between two rows.
  const crowded = labelled.some((entry, i) => i > 0 && Math.abs(x(entry.c.xMm) - x(labelled[i - 1].c.xMm)) < unit * 2.8 * 0.6 * entry.text.length)
  for (const [i, entry] of labelled.entries()) routeText(drawing, x(entry.c.xMm), z(zLow) - unit * (crowded && i % 2 ? 7 : 3.5), entry.text, entry.color, unit * 2.8)
}

/** The impedance scale at the pane's foot: a gradient strip between the lowest and highest Z0. */
function impedanceBar(drawing: GraphicsObject, pane: Viewbox, low: number, high: number): void {
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const left = pane.minX + (pane.maxX - pane.minX) * 0.3
  const right = pane.maxX - (pane.maxX - pane.minX) * 0.3
  const y = pane.minY + unit * 2.5
  for (let i = 0; i < 24; i++)
    drawing.rects!.push({ center: { x: left + ((right - left) * (i + 0.5)) / 24, y }, width: (right - left) / 24, height: unit * 1.2, fill: impedanceColor(low + ((high - low) * (i + 0.5)) / 24, low, high) })
  routeText(drawing, left - unit, y, `${low.toFixed(0)} Ω`, routeTones.quiet, unit * 2.6, 'center_right')
  routeText(drawing, right + unit, y, `${high.toFixed(0)} Ω`, routeTones.quiet, unit * 2.6, 'center_left')
}
