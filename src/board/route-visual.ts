import type { GraphicsObject, Line, Point, Viewbox } from 'graphics-debug'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import { routePosition, type RouteSlice, type RouteXY, type SectionGeometry } from './route-sections'
import { boardBounds, boardTraceWidth, boardUnderlayCopy, overlayLine } from './board-underlay'

/** A stage drawing in board mm; `focus` is where the debugger camera starts. */
export type StageDrawing = GraphicsObject & { focus?: Viewbox }

/** Saturated net colours, distinct from the muted underlay. */
export const routeNetColors = ['#1d4ed8', '#db2777', '#7c3aed', '#0e7490', '#c2410c', '#047857'] as const

/** Board mm pair as a graphics point: every stage draws in the board's own mm, y up. */
export function routePoint(point: RouteXY): Point {
  return { x: point[0], y: point[1] }
}

/** Largest side of a box. */
function span(box: Viewbox): number {
  return Math.max(box.maxX - box.minX, box.maxY - box.minY)
}

/** Union of boxes. */
export function routeUnion(...boxes: Viewbox[]): Viewbox {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  }
}

/** Pure camera target: the points' box, padded 30%, at least half the board, else the whole board. */
export function routeFocus(points: readonly Point[], board: Viewbox): Viewbox {
  if (!points.length) return board
  const box = routeUnion(...points.map((point) => ({ minX: point.x, maxX: point.x, minY: point.y, maxY: point.y })))
  const half = Math.max(span(box) * 0.65, span(board) * 0.25)
  const x = (box.minX + box.maxX) / 2
  const y = (box.minY + box.maxY) / 2
  const width = Math.max(half, (box.maxX - box.minX) * 0.65)
  const height = Math.max(half * 0.5, (box.maxY - box.minY) * 0.65)
  return { minX: x - width, maxX: x + width, minY: y - height, maxY: y + height }
}

/** Text size for a view box shown in a ~1400×620 px canvas, so labels read the same at every board size. */
export function routeTextSize(box: Viewbox): { body: number; title: number } {
  const size = Math.max(box.maxX - box.minX, (box.maxY - box.minY) * 2.2)
  return { body: size / 85, title: size / 60 }
}

/** Visible text, independent of hover labels and the SVG export's label option. */
export function routeText(drawing: GraphicsObject, x: number, y: number, text: string, color: string, fontSize: number): void {
  drawing.texts ??= []
  drawing.texts.push({ x, y, text, color, fontSize, anchorSide: 'center_left' })
}

/** Stage title in its own band above the focus, extra lines (errors, status) below it; the focus grows to include the band. */
export function routeTitle(drawing: StageDrawing, title: string, lines: readonly { text: string; color: string }[] = []): StageDrawing {
  const focus = drawing.focus ?? { minX: 0, maxX: 100, minY: 0, maxY: 40 }
  const size = routeTextSize(focus)
  const band = size.title * 1.6 + lines.length * size.body * 1.4
  const x = focus.minX + size.body
  routeText(drawing, x, focus.maxY + band - size.title * 0.8, title, '#0f172a', size.title)
  for (const [i, line] of lines.entries()) routeText(drawing, x, focus.maxY + band - size.title * 1.6 - (i + 0.5) * size.body * 1.4, line.text, line.color, size.body)
  drawing.focus = { ...focus, maxY: focus.maxY + band }
  return drawing
}

/** Deterministic display-only sampling; never changes the admitted copper or solver input. */
export function routeDisplayItems<T>(items: readonly T[], limit: number = 160): T[] {
  if (items.length <= limit) return [...items]
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))])
}

/** Human-readable net or endpoint names, with source identity as a last resort. */
export function routeNetLabel(circuit: CircuitJson, source: string): string {
  const trace = circuit.find((record) => record.type === 'source_trace' && record.source_trace_id === source)
  if (trace?.type !== 'source_trace') return source
  const net = circuit.find((record) => record.type === 'source_net' && trace.connected_source_net_ids?.includes(record.source_net_id))
  if (net?.type === 'source_net') return net.name
  return trace.connected_source_port_ids
    .slice(0, 2)
    .map((id) => routePortLabel(circuit, id))
    .join(' → ')
}

/** `U1.Y` style endpoint name. */
export function routePortLabel(circuit: CircuitJson, sourcePortId: string): string {
  const port = circuit.find((record) => record.type === 'source_port' && record.source_port_id === sourcePortId)
  if (port?.type !== 'source_port') return sourcePortId
  const component = circuit.find((record) => record.type === 'source_component' && record.source_component_id === port.source_component_id)
  return `${component?.type === 'source_component' ? component.name : ''}.${port.name}`
}

/** A source port's pad location in board mm. */
export function routePortPoint(circuit: CircuitJson, sourcePortId: string): Point | undefined {
  const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === sourcePortId)
  return port?.type === 'pcb_port' ? { x: port.x, y: port.y } : undefined
}

/** A ring glyph as an overlay line, so it paints above every underlay fill. */
export function routeRing(center: Point, radius: number, color: string, width: number): Line {
  return overlayLine(
    Array.from({ length: 25 }, (_, i) => ({ x: center.x + radius * Math.cos((i * Math.PI) / 12), y: center.y + radius * Math.sin((i * Math.PI) / 12) })),
    color,
    width,
  )
}

/** A filled dot glyph (a round-capped stub) above every underlay fill. */
export function routeDot(center: Point, radius: number, color: string): Line {
  return overlayLine([center, { x: center.x + radius * 1e-3, y: center.y }], color, radius * 2)
}

/** The board underlay plus selected copper drawn bright at its real width; focus is the selected copper. */
export function routeBoardDrawing(circuit: CircuitJson, scope: CopperScope | undefined): StageDrawing {
  const drawing: StageDrawing = boardUnderlayCopy(circuit)
  const selected: Point[] = []
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace') continue
    const rail = scope?.nonReferenceRailTraceIds.includes(trace.pcb_trace_id)
    if (!rail && !scope?.selectedPcbTraceIds.includes(trace.pcb_trace_id)) continue
    const wires = trace.route.filter((point) => point.route_type === 'wire')
    for (const [i, point] of wires.slice(1).entries()) {
      const previous = wires[i]
      const points = [routePoint([previous.x, previous.y]), routePoint([point.x, point.y])]
      drawing.lines!.push(overlayLine(points, rail ? '#16a34a' : routeNetColors[0], boardTraceWidth(circuit, point.width)))
      if (!rail) selected.push(...points)
    }
  }
  drawing.focus = routeFocus(selected, boardBounds(circuit))
  return drawing
}

/** One saturated colour per selected electrical source (source trace), in geometry order. */
export function routeSourceColors(geometry: SectionGeometry, scope: CopperScope): Map<string, string> {
  const sources = [...new Set(geometry.wires.filter((wire) => scope.selectedPcbTraceIds.includes(wire.trace)).map((wire) => wire.source))]
  return new Map(sources.map((source, i) => [source, routeNetColors[i % routeNetColors.length]]))
}

/** Colour of the selected source that connects a port, so a probe matches its copper. */
export function routePortColor(circuit: CircuitJson, colors: Map<string, string>, sourcePortId: string): string | undefined {
  const trace = circuit.find((record) => record.type === 'source_trace' && colors.has(record.source_trace_id) && record.connected_source_port_ids.includes(sourcePortId))
  return trace?.type === 'source_trace' ? colors.get(trace.source_trace_id) : undefined
}

/** Segmented wires in their net colour; orange via contacts and magenta joins sit on the real copper. */
export function routeSectionDrawing(circuit: CircuitJson, geometry: SectionGeometry, scope: CopperScope): StageDrawing {
  const drawing: StageDrawing = boardUnderlayCopy(circuit)
  const selected = geometry.wires.filter((wire) => scope.selectedPcbTraceIds.includes(wire.trace))
  const colors = routeSourceColors(geometry, scope)
  const size = Math.max(0.05, ...selected.map((wire) => wire.width))
  for (const wire of geometry.wires) {
    const rail = scope.nonReferenceRailTraceIds.includes(wire.trace)
    if (!rail && !colors.has(wire.source)) continue
    const color = rail ? '#16a34a' : colors.get(wire.source)!
    drawing.lines!.push(overlayLine([routePoint(wire.a), routePoint(wire.b)], color, wire.width))
    for (const join of wire.joins ?? []) drawing.lines!.push(routeDot(routePoint(join.from), size * 0.6, '#d946ef'))
  }
  for (const contact of routeDisplayItems(geometry.viaContacts, 400))
    drawing.lines!.push(routeRing(routePoint(contact.point), size * 1.6, '#f97316', size * 0.5))
  drawing.focus = routeFocus(
    selected.flatMap((wire) => [routePoint(wire.a), routePoint(wire.b)]),
    boardBounds(circuit),
  )
  return drawing
}

/** The bright cut line across the current slice at its midpoint; returns its two ends. */
export function routeSliceDrawing(drawing: StageDrawing, circuit: CircuitJson, slice: RouteSlice): Point[] {
  if (!slice.wires.length) return []
  const middle = (slice.start + slice.end) / 2
  const first = slice.wires[0]
  const low = Math.min(...slice.wires.map((wire) => wire.transverse - wire.width / 2))
  const high = Math.max(...slice.wires.map((wire) => wire.transverse + wire.width / 2))
  const reach = Math.max(high - low, 0.2) * 0.6
  const ends = [low - reach, high + reach].map((transverse) => routePosition({ ...first, transverse }, middle))
  const width = Math.max(0.03, (high - low) * 0.08)
  const cut = ends.map(routePoint)
  drawing.lines!.push({ ...overlayLine(cut, '#f59e0b', width), zIndex: 3 })
  return cut
}
