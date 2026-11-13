import type { GraphicsObject, Line, NinePointAnchor, Point, Polygon, Viewbox } from 'graphics-debug'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import { routePosition, type RouteSlice, type RouteWire, type SectionGeometry } from './route-sections'

/** Fixed roles over the dark board; nets get their own bright hues from routeColor. */
export const routeTones = {
  text: '#d6dde6',
  quiet: '#8b97a6',
  pane: '#11161c',
  paneEdge: '#2c3642',
  neighbour: 'rgba(203, 213, 225, 0.5)',
  reference: 'rgba(110, 231, 183, 0.5)',
  slice: '#fbbf24',
  via: '#f8fafc',
  cell: 'rgba(248, 250, 252, 0.8)',
  transition: '#fb923c',
  coupling: 'rgba(192, 132, 252, 0.85)',
  failure: '#f87171',
} as const

/** Evenly spaced bright hues, starting at cyan, readable over the dimmed board. */
export function routeColor(index: number, count: number, alpha: number = 1): string {
  return `hsla(${Math.round(195 + (index * 360) / Math.max(count, 1)) % 360}, 90%, 62%, ${alpha})`
}

/** Selected electrical sources in board order: the colour key every stage shares. */
export function routeSources(circuit: CircuitJson, scope: CopperScope): string[] {
  return [
    ...new Set(
      circuit.flatMap((record) =>
        record.type === 'pcb_trace' && record.source_trace_id && scope.selectedPcbTraceIds.includes(record.pcb_trace_id) ? [record.source_trace_id] : [],
      ),
    ),
  ]
}

/** A source's net colour, or the neighbour tone when it is not selected. */
export function routeSourceColor(sources: readonly string[], source: string, alpha: number = 1): string {
  return sources.includes(source) ? routeColor(sources.indexOf(source), sources.length, alpha) : routeTones.neighbour
}

/** Deterministic display-only sampling; never changes the admitted copper or solver input. */
export function routeDisplayItems<T>(items: readonly T[], limit: number = 160): T[] {
  if (items.length <= limit) return [...items]
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))])
}

/** Bounds of points, or undefined when there are none. */
export function routeBounds(points: readonly Point[]): Viewbox | undefined {
  if (!points.length) return
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** Decoration size for a region: marks and labels scale with what the camera shows. */
export function routeUnit(box: Viewbox): number {
  return Math.max(box.maxX - box.minX, box.maxY - box.minY) / 100
}

/** The selected copper's bounds with a margin: the region every board stage keeps in view. */
export function routeFocus(circuit: CircuitJson, scope: CopperScope): Viewbox | undefined {
  const box = routeBounds(routeCopper(circuit, scope.selectedPcbTraceIds, () => '').flatMap((line) => line.points))
  if (!box) return
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.08
  return { minX: box.minX - margin, maxX: box.maxX + margin, minY: box.minY - margin, maxY: box.maxY + margin }
}

/** Whether a point lies inside a box. */
export function routeInside(point: Point, box: Viewbox): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY
}

/** Context copper cut to the focus (Liang–Barsky per segment), so distant rails and neighbours never widen the camera. */
export function routeClip(lines: readonly Line[], box: Viewbox): Line[] {
  const clipped: Line[] = []
  for (const line of lines) {
    let run: Point[] = []
    /** Keep the current inside run as one line. */
    const flush = (): void => {
      if (run.length > 1) clipped.push({ ...line, points: run })
      run = []
    }
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1]
      const b = line.points[i]
      let low = 0
      let high = 1
      for (const [p, q] of [
        [a.x - b.x, a.x - box.minX],
        [b.x - a.x, box.maxX - a.x],
        [a.y - b.y, a.y - box.minY],
        [b.y - a.y, box.maxY - a.y],
      ]) {
        if (p === 0 && q < 0) high = -1
        else if (p < 0) low = Math.max(low, q / p)
        else if (p > 0) high = Math.min(high, q / p)
      }
      if (low > high) {
        flush()
        continue
      }
      const start = { x: a.x + (b.x - a.x) * low, y: a.y + (b.y - a.y) * low }
      if (!run.length || low > 0) {
        flush()
        run.push(start)
      }
      run.push({ x: a.x + (b.x - a.x) * high, y: a.y + (b.y - a.y) * high })
      if (high < 1) flush()
    }
    flush()
  }
  return clipped
}

/** Real-width copper polylines, one per layer and width run, tagged with their layer. */
export function routeCopper(circuit: CircuitJson, traceIds: readonly string[], color: (source: string) => string): Line[] {
  const width = circuit.find((record) => record.type === 'pcb_board')?.min_trace_width ?? 0.15
  const lines: Line[] = []
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace' || !traceIds.includes(trace.pcb_trace_id)) continue
    let run: Line | undefined
    for (const point of trace.route) {
      if (point.route_type !== 'wire') {
        run = undefined
        continue
      }
      const next = { x: point.x, y: point.y }
      if (!run || run.layer !== point.layer || run.strokeWidth !== (point.width || width)) {
        run = { points: run ? [run.points.at(-1)!] : [], strokeColor: color(trace.source_trace_id ?? ''), strokeWidth: point.width || width, layer: point.layer }
        lines.push(run)
      }
      run.points.push(next)
    }
  }
  return lines.filter((line) => line.points.length > 1)
}

/** A ring with a visible world-unit stroke; graphics-debug circles only draw hairlines. */
export function routeRing(center: Point, radius: number, color: string, width: number): Polygon {
  return {
    points: Array.from({ length: 25 }, (_, i) => ({ x: center.x + radius * Math.cos((i * Math.PI) / 12), y: center.y + radius * Math.sin((i * Math.PI) / 12) })),
    stroke: color,
    strokeWidth: width,
  }
}

/** Small world-unit text; drawn only where a number cannot be shown by shape or colour. */
export function routeText(drawing: GraphicsObject, x: number, y: number, text: string, color: string, size: number, anchor: NinePointAnchor = 'center'): void {
  drawing.texts ??= []
  drawing.texts.push({ x, y, text, color, fontSize: size, anchorSide: anchor })
}

/** A pane beside the focus, right of a tall focus and below a wide one, with its content's width/height aspect. */
export function routePaneBox(focus: Viewbox, aspect: number): Viewbox {
  const width = focus.maxX - focus.minX
  const height = focus.maxY - focus.minY
  const gap = Math.max(width, height) * 0.04
  if (height >= width) {
    const paneHeight = height * 0.55
    const middle = (focus.minY + focus.maxY) / 2
    return { minX: focus.maxX + gap, maxX: focus.maxX + gap + paneHeight * aspect, minY: middle - paneHeight / 2, maxY: middle + paneHeight / 2 }
  }
  const paneWidth = width * 0.8
  const middle = (focus.minX + focus.maxX) / 2
  return { minX: middle - paneWidth / 2, maxX: middle + paneWidth / 2, minY: focus.minY - gap - paneWidth / aspect, maxY: focus.minY - gap }
}

/** An opaque pane: a thick line at zIndex -1 fills it, because graphics-debug paints every line before other shapes. */
export function routePane(drawing: GraphicsObject, box: Viewbox, edge: string = routeTones.paneEdge): void {
  const middle = (box.minY + box.maxY) / 2
  drawing.lines ??= []
  drawing.polygons ??= []
  drawing.lines.push({ points: [{ x: box.minX, y: middle }, { x: box.maxX, y: middle }], strokeColor: routeTones.pane, strokeWidth: box.maxY - box.minY, zIndex: -1 })
  drawing.polygons.push({
    points: [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ],
    stroke: edge,
    strokeWidth: routeUnit(box) * 0.25,
  })
}

/** One short red line of explanation at the top left of what is drawn, else of the board. */
export function routeFailure(drawing: GraphicsObject, circuit: CircuitJson, message: string): void {
  const board = circuit.find((record) => record.type === 'pcb_board')
  const box = routeBounds([...(drawing.lines ?? []).flatMap((line) => line.points), ...(drawing.polygons ?? []).flatMap((polygon) => polygon.points)]) ??
    (board ? { minX: board.center.x - (board.width ?? 0) / 2, maxX: board.center.x + (board.width ?? 0) / 2, minY: board.center.y - (board.height ?? 0) / 2, maxY: board.center.y + (board.height ?? 0) / 2 } : { minX: 0, maxX: 10, minY: 0, maxY: 10 })
  const unit = routeUnit(box)
  routeText(drawing, box.minX, box.maxY + unit * 4, message.length > 110 ? `${message.slice(0, 107)}…` : message, routeTones.failure, unit * 2.6, 'center_left')
}

/** Selected copper in net colours and rail copper in green; nothing without a scope, so the whole board shows. */
export function routeBoardDrawing(circuit: CircuitJson, scope: CopperScope | undefined, alpha: number = 1): GraphicsObject {
  const drawing: GraphicsObject = { coordinateSystem: 'cartesian', lines: [], circles: [], polygons: [], rects: [], texts: [] }
  if (!scope) return drawing
  const sources = routeSources(circuit, scope)
  const focus = routeFocus(circuit, scope)
  drawing.lines!.push(
    ...(focus ? routeClip(routeCopper(circuit, scope.nonReferenceRailTraceIds, () => routeTones.reference), focus) : []),
    ...routeCopper(circuit, scope.selectedPcbTraceIds, (source) => routeSourceColor(sources, source, alpha)),
  )
  return drawing
}

/** Size marks to the selected copper, else to the board. */
export function routeDrawingUnit(drawing: GraphicsObject, circuit: CircuitJson): number {
  const board = circuit.find((record) => record.type === 'pcb_board')
  const box = routeBounds((drawing.lines ?? []).flatMap((line) => line.points)) ?? { minX: 0, maxX: board?.width ?? 10, minY: 0, maxY: board?.height ?? 10 }
  return routeUnit(box)
}

/** Pin marks, a filled dot for a driver and a ring for anything that listens, never larger than half their closest spacing. */
export function routeMarks(drawing: GraphicsObject, marks: readonly { point: Point; color: string; driver: boolean }[], unit: number): void {
  drawing.circles ??= []
  drawing.polygons ??= []
  let spacing = Infinity
  for (const [i, a] of marks.entries())
    for (const b of marks.slice(i + 1)) {
      const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y)
      if (distance > 1e-9) spacing = Math.min(spacing, distance)
    }
  const radius = Math.min(unit * 1.1, spacing * 0.42)
  for (const mark of marks)
    if (mark.driver) drawing.circles.push({ center: mark.point, radius, fill: mark.color, stroke: mark.color })
    else drawing.polygons.push(routeRing(mark.point, radius * 0.95, mark.color, radius * 0.4))
}

/** The physical position of a source port. */
export function routePortPoint(circuit: CircuitJson, sourcePortId: string): Point | undefined {
  const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === sourcePortId)
  return port?.type === 'pcb_port' ? { x: port.x, y: port.y } : undefined
}

/** Lane endpoints at their pads, in their net's colour: drivers as dots, receivers as rings. */
export function routeEndpoints(drawing: GraphicsObject, circuit: CircuitJson, scope: CopperScope, mappings: readonly { from: string; to: string; sourceTraceId: string }[]): void {
  const sources = routeSources(circuit, scope)
  const marks = mappings.flatMap((mapping) =>
    ([
      [mapping.from, true],
      [mapping.to, false],
    ] as const).flatMap(([id, driver]) => {
      const point = routePortPoint(circuit, id)
      return point ? [{ point, color: routeSourceColor(sources, mapping.sourceTraceId), driver }] : []
    }),
  )
  routeMarks(drawing, marks, routeDrawingUnit(drawing, circuit))
}

/** A section as copper between its ends, optionally pulled back slightly so every partition shows as a gap. */
function sectionLine(wire: RouteWire, color: string, gaps: boolean): Line {
  const length = Math.hypot(wire.b[0] - wire.a[0], wire.b[1] - wire.a[1])
  const trim = gaps ? Math.min(wire.width * 0.35, length * 0.15) / Math.max(length, 1e-12) : 0
  /** The point a fraction t along the section. */
  const at = (t: number): Point => ({ x: wire.a[0] + (wire.b[0] - wire.a[0]) * t, y: wire.a[1] + (wire.b[1] - wire.a[1]) * t })
  return { points: [at(trim), at(1 - trim)], strokeColor: color, strokeWidth: wire.width, layer: wire.layer }
}

/** Sectioned copper: selected sections in net colours, neighbours pale, unsectioned scope copper faint, vias as rings; `gaps` shows each partition. */
export function routeSectionDrawing(circuit: CircuitJson, geometry: SectionGeometry, scope: CopperScope, gaps: boolean = false): GraphicsObject {
  const sources = routeSources(circuit, scope)
  const done = new Set(geometry.wires.map((wire) => wire.trace))
  const focus = routeFocus(circuit, scope)
  const drawing: GraphicsObject = { coordinateSystem: 'cartesian', lines: [], circles: [], polygons: [], rects: [], texts: [] }
  const selected = geometry.wires.filter((wire) => scope.selectedPcbTraceIds.includes(wire.trace))
  const context = [
    // Every scope trace is drawn from the first step, so the camera holds still while sections appear.
    ...routeCopper(
      circuit,
      scope.pcbTraceIds.filter((id) => !done.has(id) && !scope.selectedPcbTraceIds.includes(id)),
      () => 'rgba(203, 213, 225, 0.2)',
    ),
    ...geometry.wires
      .filter((wire) => !scope.selectedPcbTraceIds.includes(wire.trace))
      .map((wire) => sectionLine(wire, scope.nonReferenceRailTraceIds.includes(wire.trace) ? routeTones.reference : routeTones.neighbour, gaps)),
  ]
  drawing.lines!.push(
    ...(focus ? routeClip(context, focus) : context),
    ...routeCopper(
      circuit,
      scope.selectedPcbTraceIds.filter((id) => !done.has(id)),
      (source) => routeSourceColor(sources, source, 0.3),
    ),
    ...selected.map((wire) => sectionLine(wire, routeSourceColor(sources, wire.source), gaps)),
  )
  const width = selected.length ? selected.reduce((sum, wire) => sum + wire.width, 0) / selected.length : 0.1
  for (const contact of geometry.viaContacts)
    if (scope.selectedPcbTraceIds.includes(contact.trace)) drawing.polygons!.push(routeRing({ x: contact.point[0], y: contact.point[1] }, width * 1.6, routeTones.via, width * 0.4))
  for (const join of selected.flatMap((wire) => wire.joins ?? []))
    drawing.circles!.push({ center: { x: join.from[0], y: join.from[1] }, radius: width * 0.5, fill: routeTones.via, stroke: routeTones.via })
  return drawing
}

/** The slice being solved: an amber cut across its conductors at the slice midpoint, at least `unit` thick so it shows at any zoom. */
export function routeSliceDrawing(drawing: GraphicsObject, slice: RouteSlice, unit: number): Point[] {
  if (!slice.wires.length) return []
  const middle = (slice.start + slice.end) / 2
  const first = slice.wires[0]
  const margin = Math.max(...slice.wires.map((wire) => wire.width), unit * 1.5)
  const half = Math.max(margin * 0.25, unit * 0.4)
  const low = Math.min(...slice.wires.map((wire) => wire.transverse - wire.width / 2)) - margin
  const high = Math.max(...slice.wires.map((wire) => wire.transverse + wire.width / 2)) + margin
  const points = [
    [middle - half, low],
    [middle + half, low],
    [middle + half, high],
    [middle - half, high],
  ].map(([position, transverse]) => {
    const [x, y] = routePosition({ ...first, transverse }, position)
    return { x, y }
  })
  drawing.polygons ??= []
  drawing.polygons.push({ points, fill: routeTones.slice, stroke: routeTones.slice, strokeWidth: unit * 0.1 })
  return points
}
