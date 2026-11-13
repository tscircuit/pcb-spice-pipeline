import type { GraphicsObject, Line, NinePointAnchor, Point, Viewbox } from 'graphics-debug'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import { connectedSourceIds } from './connectivity'

/** Fixed roles over the dark board; nets get their own bright hues. */
export const routeTones = {
  text: '#d6dde6',
  quiet: '#8b97a6',
  pane: '#11161c',
  paneEdge: '#2c3642',
  copper: '#9aa3ad',
  halo: '#0b0f13',
  slice: '#fbbf24',
  via: '#f8fafc',
  cell: 'rgba(248, 250, 252, 0.85)',
  coupling: 'rgba(192, 132, 252, 0.8)',
  threshold: 'rgba(251, 191, 36, 0.16)',
  envelope: 'rgba(203, 213, 225, 0.3)',
  failure: '#f87171',
} as const

/** One electrical net's drawing style; a differential pair shares a hue at two lightnesses. */
export interface RouteNet {
  label: string
  hue: number
  lightness: number
  color: string
  /** Bit period of the channel that drives this net, when one does. */
  unitInterval?: number
  /** One leg of a differential pair. */
  differential: boolean
}

/** The fixed framing of one problem: the selected copper's focus, a pane slot beside it and their union. */
export interface RouteFrame {
  focus: Viewbox
  pane: Viewbox
  camera: Viewbox
  unit: number
}

/** A problem's framing plus its nets, shared by every stage so the camera and colours never move. */
export interface RouteView extends RouteFrame {
  traces: Set<string>
  sources: Map<string, RouteNet>
  ports: Map<string, RouteNet>
}

/** A hue as a colour; `lightness` separates differential legs and section tones. */
export function routeHue(hue: number, lightness: number = 62, alpha: number = 1): string {
  return `hsla(${Math.round(hue) % 360}, 90%, ${lightness}%, ${alpha})`
}

/** Bounds of points, or undefined when there are none. */
export function routeBounds(points: readonly Point[]): Viewbox | undefined {
  if (!points.length) return
  let box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (const point of points) box = { minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x), minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y) }
  return box
}

/** Deterministic display-only sampling; never changes the admitted copper or solver input. */
export function routeDisplayItems<T>(items: readonly T[], limit: number = 160): T[] {
  if (items.length <= limit) return [...items]
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))])
}

/** A focus box with a pane slot on whichever side brings the camera closest to 1.6:1. */
export function routeFrame(box: Viewbox): RouteFrame {
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3) * 0.06
  const focus = { minX: box.minX - margin, maxX: box.maxX + margin, minY: box.minY - margin, maxY: box.maxY + margin }
  const width = focus.maxX - focus.minX
  const height = focus.maxY - focus.minY
  const gap = Math.max(width, height) * 0.03
  const side = Math.max(0.6 * height, 1.6 * height - width)
  const below = Math.max(0.35 * width, width / 1.6 - height)
  const right = Math.abs(Math.log((width + gap + side) / height / 1.6)) <= Math.abs(Math.log(width / (height + gap + below) / 1.6))
  const pane = right
    ? { minX: focus.maxX + gap, maxX: focus.maxX + gap + side, minY: focus.minY, maxY: focus.maxY }
    : { minX: focus.minX, maxX: focus.maxX, minY: focus.minY - gap - below, maxY: focus.minY - gap }
  const camera = { minX: Math.min(focus.minX, pane.minX), maxX: Math.max(focus.maxX, pane.maxX), minY: Math.min(focus.minY, pane.minY), maxY: Math.max(focus.maxY, pane.maxY) }
  return { focus, pane, camera, unit: Math.max(camera.maxX - camera.minX, camera.maxY - camera.minY) / 100 }
}

const views = new WeakMap<CopperScope, WeakMap<CircuitJson, RouteView>>()

/** Selected copper plus its endpoint components frame the problem; nets follow electrical connectivity, and differential channels pair two nets in one hue. */
export function routeView(circuit: CircuitJson, scope: CopperScope): RouteView {
  const cached = views.get(scope)?.get(circuit)
  if (cached) return cached
  const traces = new Set(scope.selectedPcbTraceIds)
  const points: Point[] = []
  const ends = new Set<string>()
  const order: string[] = []
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace' || !traces.has(trace.pcb_trace_id)) continue
    if (trace.source_trace_id && !order.includes(trace.source_trace_id)) order.push(trace.source_trace_id)
    for (const point of trace.route) {
      if (point.route_type !== 'wire') continue
      points.push(point)
      for (const id of [point.start_pcb_port_id, point.end_pcb_port_id]) if (id) ends.add(id)
    }
  }
  // Endpoint parts join the focus, but a large package (a BGA) only near the copper.
  const copper = routeBounds(points) ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const reach = Math.max(copper.maxX - copper.minX, copper.maxY - copper.minY) * 0.25
  const components = new Set(circuit.flatMap((port) => (port.type === 'pcb_port' && ends.has(port.pcb_port_id) && port.pcb_component_id ? [port.pcb_component_id] : [])))
  for (const component of circuit) {
    if (component.type !== 'pcb_component' || !components.has(component.pcb_component_id)) continue
    const corners = routeOutline(component)
    for (const corner of corners)
      points.push({ x: Math.min(copper.maxX + reach, Math.max(copper.minX - reach, corner.x)), y: Math.min(copper.maxY + reach, Math.max(copper.minY - reach, corner.y)) })
  }
  // Group selected source traces into electrical nets by shared ports and nets.
  const nets: { ids: Set<string>; sources: string[] }[] = []
  for (const id of order) {
    const source = circuit.find((record) => record.type === 'source_trace' && record.source_trace_id === id)
    const seed = source?.type === 'source_trace' ? (source.connected_source_port_ids[0] ?? source.connected_source_net_ids?.[0]) : undefined
    const net = seed ? nets.find((entry) => entry.ids.has(seed)) : undefined
    if (net) net.sources.push(id)
    else nets.push({ ids: seed ? connectedSourceIds(circuit, seed) : new Set([id]), sources: [id] })
  }
  // Channels come from signal records in a whole circuit, or from the per-driver stimuli of an admitted block; both name the same pairs and bit periods.
  const channels = new Map<string, { ends: Set<string>; legs: string[]; unitInterval: number }>()
  for (const record of circuit) {
    // Read structurally: some circuit-json releases leave signal records out of the record union.
    const signal = record as unknown as { type: string; name: string; driver: Record<string, unknown>; receivers: Record<string, unknown>[]; bit_rate_bps: number }
    if (signal.type === 'simulation_signal') {
      const legs = [signal.driver.p_source_port_id, signal.driver.n_source_port_id].every((port) => typeof port === 'string') ? [signal.driver.p_source_port_id, signal.driver.n_source_port_id] : [signal.driver.source_port_id]
      channels.set(signal.name, { ends: new Set([signal.driver, ...signal.receivers].flatMap((end) => Object.values(end).filter((value): value is string => typeof value === 'string'))), legs: legs.filter((port): port is string => typeof port === 'string'), unitInterval: 1 / signal.bit_rate_bps })
    }
    if (record.type === 'simulation_digital_stimulus' && record.name) {
      const channel = channels.get(record.name) ?? { ends: new Set<string>(), legs: [], unitInterval: record.bit_duration_ms / 1000 }
      channel.ends.add(record.source_port_id)
      if (!channel.legs.includes(record.source_port_id)) channel.legs[record.inverted ? 1 : channel.legs[0] ? 1 : 0] = record.source_port_id
      channels.set(record.name, channel)
    }
  }
  const units: { nets: (typeof nets)[number][]; name?: string; unitInterval?: number }[] = []
  for (const net of nets) {
    if (units.some((unit) => unit.nets.includes(net))) continue
    const [name, channel] = [...channels].find(([, entry]) => [...entry.ends].some((port) => net.ids.has(port))) ?? []
    const pair = (channel?.legs.length === 2 ? channel.legs : []).map((port) => nets.find((entry) => entry.ids.has(port))).filter((entry): entry is (typeof nets)[number] => !!entry)
    units.push({ nets: pair.length === 2 && pair[0] !== pair[1] ? pair : [net], name, unitInterval: channel?.unitInterval })
  }
  const sources = new Map<string, RouteNet>()
  const ports = new Map<string, RouteNet>()
  for (const [i, unit] of units.entries())
    for (const [leg, net] of unit.nets.entries()) {
      const hue = 195 + (i * 360) / units.length
      const lightness = unit.nets.length > 1 ? (leg ? 48 : 74) : 62
      const port = [...net.ids].find((id) => circuit.some((record) => record.type === 'source_port' && record.source_port_id === id))
      const style = { label: unit.name ? `${unit.name}${unit.nets.length > 1 ? (leg ? ' N' : ' P') : ''}` : (port ?? net.sources[0]), hue, lightness, color: routeHue(hue, lightness), unitInterval: unit.unitInterval, differential: unit.nets.length > 1 }
      for (const id of net.sources) sources.set(id, style)
      for (const id of net.ids) ports.set(id, style)
    }
  const box = routeBounds(points) ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const view = { ...routeFrame(box), traces, sources, ports }
  const byCircuit = views.get(scope) ?? new WeakMap<CircuitJson, RouteView>()
  byCircuit.set(circuit, view)
  views.set(scope, byCircuit)
  return view
}

/** A drawing that carries its fixed camera as an invisible frame the board picture crops to. */
export function routeCanvas(frame?: RouteFrame): GraphicsObject {
  const drawing: GraphicsObject = { coordinateSystem: 'cartesian', lines: [], circles: [], polygons: [], rects: [], texts: [] }
  if (frame)
    drawing.rects!.push({
      center: { x: (frame.camera.minX + frame.camera.maxX) / 2, y: (frame.camera.minY + frame.camera.maxY) / 2 },
      width: frame.camera.maxX - frame.camera.minX,
      height: frame.camera.maxY - frame.camera.minY,
      fill: 'none',
      stroke: 'none',
      label: 'camera',
    })
  return drawing
}

/** Copper with its layer in the stroke: top solid, inner layers hollow, bottom dimmed. */
export function routeStroke(points: Point[], color: string, width: number, layer: string, label?: string): Line[] {
  const line = { points, strokeColor: color, strokeWidth: width, label }
  if (layer === 'top') return [line]
  if (layer === 'bottom') return [line, { points, strokeColor: 'rgba(11, 15, 19, 0.5)', strokeWidth: width, label }]
  return [line, { points, strokeColor: routeTones.halo, strokeWidth: width * 0.45, label }]
}

/** Selected copper as layer-aware strokes, one colour per net unless `color` overrides it. */
export function routeNets(drawing: GraphicsObject, circuit: CircuitJson, view: RouteView, traceIds: Set<string> = view.traces, color?: (net: RouteNet | undefined) => string): void {
  const fallback = circuit.find((record) => record.type === 'pcb_board')?.min_trace_width ?? 0.15
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace' || !traceIds.has(trace.pcb_trace_id)) continue
    const net = view.sources.get(trace.source_trace_id ?? '')
    let run: { points: Point[]; layer: string; width: number } | undefined
    /** Emit the current run of one layer and width. */
    const flush = (): void => {
      if (run && run.points.length > 1) drawing.lines!.push(...routeStroke(run.points, color ? color(net) : (net?.color ?? routeTones.copper), run.width, run.layer, net?.label))
    }
    for (const point of trace.route) {
      if (point.route_type !== 'wire') {
        flush()
        run = undefined
        continue
      }
      if (!run || run.layer !== point.layer || run.width !== (point.width || fallback)) {
        const last = run?.points.at(-1)
        flush()
        run = { points: last ? [last] : [], layer: point.layer, width: point.width || fallback }
      }
      run.points.push({ x: point.x, y: point.y })
    }
    flush()
  }
}

/** A closed circle outline as polygon points. */
function circle(center: Point, radius: number): Point[] {
  return Array.from({ length: 24 }, (_, i) => ({ x: center.x + radius * Math.cos((i * Math.PI) / 12), y: center.y + radius * Math.sin((i * Math.PI) / 12) }))
}

/** Pin marks over a dark halo, a dot for a driver and a ring for anything that listens, never wider than their spacing allows. */
export function routeMarks(drawing: GraphicsObject, marks: readonly { point: Point; color: string; driver: boolean; label?: string }[], unit: number): void {
  const radius = Math.min(unit * 1.1, spacing(marks.map((mark) => mark.point)) * 0.38)
  for (const mark of marks) {
    drawing.polygons!.push({ points: circle(mark.point, radius * 1.25), fill: routeTones.halo, stroke: 'none', label: mark.label })
    drawing.polygons!.push(
      mark.driver
        ? { points: circle(mark.point, radius), fill: mark.color, stroke: 'none', label: mark.label }
        : { points: circle(mark.point, radius * 0.8), stroke: mark.color, strokeWidth: radius * 0.4, label: mark.label },
    )
  }
}

/** The one via glyph every stage uses: a white ring over a dark halo. */
export function routeVia(drawing: GraphicsObject, center: Point, radius: number): void {
  drawing.polygons!.push({ points: circle(center, radius * 1.2), stroke: routeTones.halo, strokeWidth: radius * 0.5 })
  drawing.polygons!.push({ points: circle(center, radius), stroke: routeTones.via, strokeWidth: radius * 0.28 })
}

/** The physical position of a source port. */
export function routePortPoint(circuit: CircuitJson, sourcePortId: string): Point | undefined {
  const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === sourcePortId)
  return port?.type === 'pcb_port' ? { x: port.x, y: port.y } : undefined
}

/** Small world-unit text; drawn only where a number cannot be shown by shape or colour. */
export function routeText(drawing: GraphicsObject, x: number, y: number, text: string, color: string, size: number, anchor: NinePointAnchor = 'center'): void {
  drawing.texts!.push({ x, y, text, color, fontSize: size, anchorSide: anchor })
}

/** An opaque pane: a thick line at zIndex -1 fills it, because graphics-debug paints every line before other shapes. */
export function routePane(drawing: GraphicsObject, box: Viewbox, edge: string = routeTones.paneEdge): void {
  const middle = (box.minY + box.maxY) / 2
  drawing.lines!.push({ points: [{ x: box.minX, y: middle }, { x: box.maxX, y: middle }], strokeColor: routeTones.pane, strokeWidth: box.maxY - box.minY, zIndex: -1 })
  drawing.polygons!.push({
    points: [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ],
    stroke: edge,
    strokeWidth: Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.003,
  })
}

/** A failure reason in the pane slot (or across the board without one), wrapped to at most three lines that fit. */
export function routeFailure(drawing: GraphicsObject, box: Viewbox, message: string): void {
  const width = box.maxX - box.minX
  const size = Math.min((box.maxY - box.minY) * 0.06, width / 40)
  const perLine = Math.max(10, Math.floor((width * 0.9) / (size * 0.6)))
  const lines = (message.match(new RegExp(`.{1,${perLine}}(\\s|$)`, 'g')) ?? [message]).slice(0, 3)
  for (const [i, line] of lines.entries()) routeText(drawing, box.minX + width * 0.05, box.maxY - size * (1.6 + i * 1.3), line.trim(), routeTones.failure, size, 'center_left')
}

/** The board's extent: its outline, its rectangle, else every positioned pcb record. */
export function routeBoardBox(circuit: CircuitJson): Viewbox {
  const board = circuit.find((record) => record.type === 'pcb_board')
  if (board?.outline?.length) return routeBounds(board.outline)!
  if (board?.width && board.height) return { minX: board.center.x - board.width / 2, maxX: board.center.x + board.width / 2, minY: board.center.y - board.height / 2, maxY: board.center.y + board.height / 2 }
  const points = circuit.flatMap((record) => ('x' in record && 'y' in record && typeof record.x === 'number' && typeof record.y === 'number' && record.type.startsWith('pcb_') ? [{ x: record.x, y: record.y }] : []))
  return routeBounds(points) ?? { minX: -1, maxX: 1, minY: -1, maxY: 1 }
}

/** The problem's canvas with its selected copper in net colours; without a scope it is empty, so the whole board shows. */
export function routeBoardDrawing(circuit: CircuitJson, scope: CopperScope | undefined, color?: (net: RouteNet | undefined) => string): GraphicsObject {
  if (!scope) return routeCanvas()
  const view = routeView(circuit, scope)
  const drawing = routeCanvas(view)
  routeNets(drawing, circuit, view, view.traces, color)
  return drawing
}

/** Closest spacing between distinct points, so glyphs never overlap their neighbours. */
function spacing(points: readonly Point[]): number {
  let closest = Infinity
  for (const [i, a] of points.entries())
    for (const b of points.slice(i + 1)) {
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance > 1e-9) closest = Math.min(closest, distance)
    }
  return closest
}

/** Which way the selected copper leaves a pin, as a unit vector (east when no copper touches it). */
export function routePinDirection(circuit: CircuitJson, view: RouteView, pin: Point): Point {
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace' || !view.traces.has(trace.pcb_trace_id)) continue
    const wires = trace.route.flatMap((point) => (point.route_type === 'wire' ? [{ x: point.x, y: point.y }] : []))
    for (const [i, point] of wires.entries()) {
      if (Math.hypot(point.x - pin.x, point.y - pin.y) > 1e-3) continue
      const next = wires[i + 1] ?? wires[i - 1]
      const length = next ? Math.hypot(next.x - point.x, next.y - point.y) : 0
      if (length > 1e-9) return { x: (next.x - point.x) / length, y: (next.y - point.y) / length }
    }
  }
  return { x: 1, y: 0 }
}

/** IBIS buffer glyphs at their pins: a filled ▶ leaving each driver, a hollow ◀ arriving at each receiver, over a dark halo. */
export function routeBuffers(drawing: GraphicsObject, buffers: readonly { point: Point; direction: Point; color: string; driver: boolean; label?: string }[], unit: number): void {
  const size = Math.min(unit * 1.6, spacing(buffers.map((buffer) => buffer.point)) * 0.48)
  for (const buffer of buffers) {
    const along = buffer.driver ? buffer.direction : { x: -buffer.direction.x, y: -buffer.direction.y }
    const across = { x: -along.y, y: along.x }
    const tip = buffer.driver ? { x: buffer.point.x + along.x * size * 1.6, y: buffer.point.y + along.y * size * 1.6 } : buffer.point
    const base = { x: tip.x - along.x * size * 1.6, y: tip.y - along.y * size * 1.6 }
    const points = [tip, { x: base.x + across.x * size * 0.8, y: base.y + across.y * size * 0.8 }, { x: base.x - across.x * size * 0.8, y: base.y - across.y * size * 0.8 }]
    drawing.polygons!.push({ points, fill: buffer.driver ? buffer.color : routeTones.halo, stroke: buffer.driver ? routeTones.halo : buffer.color, strokeWidth: size * 0.25, label: buffer.label })
  }
}

/** A component's outline as a rotated rectangle. */
export function routeOutline(component: { center: Point; width: number; height: number; rotation?: number }): Point[] {
  const turn = ((component.rotation ?? 0) * Math.PI) / 180
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * component.width) / 2
    const y = (sy * component.height) / 2
    return { x: component.center.x + x * Math.cos(turn) - y * Math.sin(turn), y: component.center.y + x * Math.sin(turn) + y * Math.cos(turn) }
  })
}

export interface RouteStripRow {
  net: RouteNet
  length: number
  /** Coloured pieces along the unrolled net; `casing` marks the piece being worked on. */
  parts?: { from: number; to: number; color: string; casing?: boolean }[]
  ticks?: number[]
  /** Coupling to neighbours along the net, drawn under the bar with height growing with k. */
  bands?: { from: number; to: number; k: number }[]
}

/** Every net unrolled into a to-scale bar in the pane, with a quiet name and the longest length; buffer glyphs at the ends when `buffers` is set. */
export function routeStrip(drawing: GraphicsObject, pane: Viewbox, rows: readonly RouteStripRow[], buffers?: { driver: boolean; receiver: boolean }): void {
  routePane(drawing, pane)
  if (!rows.length) return
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const left = pane.minX + (pane.maxX - pane.minX) * 0.2
  const right = pane.maxX - unit * 4
  const pitch = Math.min((pane.maxY - pane.minY - unit * 10) / rows.length, unit * 6)
  const longest = Math.max(...rows.map((row) => row.length), 1e-9)
  const bar = Math.min(pitch * 0.4, unit * 1.6)
  /** Position along a net to the pane. */
  const x = (position: number): number => left + (position / longest) * (right - left)
  const glyphs: Parameters<typeof routeBuffers>[1][number][] = []
  for (const [i, row] of rows.entries()) {
    const y = (pane.minY + pane.maxY) / 2 + pitch * (rows.length / 2 - i - 0.5)
    for (const band of row.bands ?? [])
      drawing.lines!.push({ points: [{ x: x(band.from), y: y - bar }, { x: x(band.to), y: y - bar }], strokeColor: routeTones.coupling, strokeWidth: Math.min(pitch * 0.45, bar * 4 * Math.min(1, band.k / 0.25)), zIndex: -0.5, label: `k ${band.k.toFixed(2)}` })
    for (const part of row.parts ?? [{ from: 0, to: row.length, color: row.net.color }]) {
      if (part.casing) drawing.lines!.push({ points: [{ x: x(part.from), y }, { x: x(part.to), y }], strokeColor: routeTones.via, strokeWidth: bar * 1.8 })
      drawing.lines!.push({ points: [{ x: x(part.from), y }, { x: x(part.to), y }], strokeColor: part.color, strokeWidth: bar, label: row.net.label })
    }
    for (const tick of row.ticks ?? []) drawing.lines!.push({ points: [{ x: x(tick), y: y - bar }, { x: x(tick), y: y + bar }], strokeColor: routeTones.cell, strokeWidth: unit * 0.15 })
    if (rows.length <= 32) routeText(drawing, left - unit * 2, y, row.net.label, routeTones.quiet, Math.min(unit * 2.6, pitch * 0.8), 'center_right')
    if (buffers) glyphs.push({ point: { x: x(0) - unit, y }, direction: { x: 1, y: 0 }, color: row.net.color, driver: true, label: row.net.label }, { point: { x: x(row.length) + unit * 0.5, y }, direction: { x: -1, y: 0 }, color: row.net.color, driver: false, label: row.net.label })
  }
  if (glyphs.length) routeBuffers(drawing, glyphs, unit)
  routeText(drawing, right, (pane.minY + pane.maxY) / 2 + pitch * (rows.length / 2) + unit * 2, `${longest.toFixed(longest < 10 ? 2 : 1)} mm`, routeTones.quiet, unit * 2.6, 'center_right')
}

/** Each selected net's routed length from its copper, in net order. */
export function routeLengths(circuit: CircuitJson, view: RouteView): RouteStripRow[] {
  const lengths = new Map<RouteNet, number>()
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace' || !view.traces.has(trace.pcb_trace_id)) continue
    const net = view.sources.get(trace.source_trace_id ?? '')
    if (!net) continue
    const wires = trace.route.flatMap((point) => (point.route_type === 'wire' ? [point] : []))
    lengths.set(net, (lengths.get(net) ?? 0) + wires.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - wires[i].x, point.y - wires[i].y), 0))
  }
  return [...lengths].map(([net, length]) => ({ net, length }))
}

/** Selected section wires laid end to end per net, so a position on a wire becomes a distance along its net. */
export function routeUnrolled(view: RouteView, wires: readonly { id: number; trace: string; source: string; start: number; end: number }[]): { lengths: Map<RouteNet, number>; along: (id: number, position: number) => { net: RouteNet; distance: number } | undefined } {
  const lengths = new Map<RouteNet, number>()
  const offsets = new Map<number, { net: RouteNet; offset: number; start: number }>()
  for (const wire of wires) {
    const net = view.traces.has(wire.trace) ? view.sources.get(wire.source) : undefined
    if (!net) continue
    offsets.set(wire.id, { net, offset: lengths.get(net) ?? 0, start: wire.start })
    lengths.set(net, (lengths.get(net) ?? 0) + wire.end - wire.start)
  }
  return {
    lengths,
    along: (id, position) => {
      const entry = offsets.get(id)
      return entry && { net: entry.net, distance: entry.offset + position - entry.start }
    },
  }
}
