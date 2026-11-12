import type { GraphicsObject, Point } from 'graphics-debug'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import { routePosition, type RouteXY, type RouteSlice, type SectionGeometry } from './route-sections'

/** Visible text is independent of hover labels and the SVG export's label option. */
export function routeText(drawing: GraphicsObject, x: number, y: number, text: string, color: string = '#334155', fontSize: number = 2): void {
  drawing.texts ??= []
  drawing.texts.push({ x, y, text, color, fontSize, anchorSide: 'center_left' })
}

/** Deterministic display-only sampling; never changes the admitted copper or solver input. */
export function routeDisplayItems<T>(items: readonly T[], limit: number = 160): T[] {
  if (items.length <= limit) return [...items]
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))])
}

/** Board millimetres fitted into the shared 0..100 atlas panel, positive y upward. */
export function routeBoardPoint(circuit: CircuitJson, point: RouteXY): Point {
  const board = circuit.find((record) => record.type === 'pcb_board')
  const scale = 68 / Math.max(board?.width ?? 1, board?.height ?? 1)
  return { x: 50 + (point[0] - (board?.center.x ?? 0)) * scale, y: 50 + (point[1] - (board?.center.y ?? 0)) * scale }
}

/** Human-readable net or endpoint names, with source identity as a last resort. */
export function routeNetLabel(circuit: CircuitJson, source: string): string {
  const trace = circuit.find((record) => record.type === 'source_trace' && record.source_trace_id === source)
  if (trace?.type !== 'source_trace') return source
  const net = circuit.find((record) => record.type === 'source_net' && trace.connected_source_net_ids?.includes(record.source_net_id))
  if (net?.type === 'source_net') return net.name
  return trace.connected_source_port_ids
    .slice(0, 2)
    .map((id) => {
      const port = circuit.find((record) => record.type === 'source_port' && record.source_port_id === id)
      const component =
        port?.type === 'source_port' && circuit.find((record) => record.type === 'source_component' && record.source_component_id === port.source_component_id)
      return port?.type === 'source_port' ? `${component && component.type === 'source_component' ? component.name : ''}.${port.name}` : id
    })
    .join(' → ')
}

/** Actual route polylines and pour outlines; object counts stay bounded on full DDR boards. */
export function routeBoardDrawing(circuit: CircuitJson, scope: CopperScope | undefined, title: string): GraphicsObject {
  const traces = circuit.filter((record) => record.type === 'pcb_trace')
  const selected = traces.filter((trace) => scope?.selectedPcbTraceIds.includes(trace.pcb_trace_id))
  const neighbours = traces.filter((trace) => !selected.includes(trace))
  const drawing: GraphicsObject = { coordinateSystem: 'cartesian', lines: [], texts: [], points: [], circles: [], rects: [], polygons: [] }
  const board = circuit.find((record) => record.type === 'pcb_board')
  if (board) {
    const scale = 68 / Math.max(board.width ?? 1, board.height ?? 1)
    drawing.rects!.push({ center: { x: 50, y: 50 }, width: (board.width ?? 1) * scale, height: (board.height ?? 1) * scale, stroke: '#94a3b8' })
  }
  for (const trace of [...routeDisplayItems(neighbours, 120), ...selected]) {
    const points = routeDisplayItems(
      trace.route.filter((point) => 'x' in point && 'y' in point),
      500,
    ).map((point) => routeBoardPoint(circuit, [point.x!, point.y!]))
    if (points.length < 2) continue
    drawing.lines!.push({
      points,
      strokeColor: scope?.nonReferenceRailTraceIds.includes(trace.pcb_trace_id) ? '#16a34a' : selected.includes(trace) ? '#2563eb' : '#cbd5e1',
      strokeWidth: selected.includes(trace) ? 0.5 : 0.1,
    })
  }
  for (const pour of routeDisplayItems(
    circuit.filter((record) => record.type === 'pcb_copper_pour'),
    40,
  )) {
    if (pour.shape !== 'brep') continue
    for (const [i, ring] of [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings].slice(0, 8).entries()) {
      const vertices = routeDisplayItems(ring.vertices, 300).map((point) => routeBoardPoint(circuit, [point.x, point.y]))
      if (vertices.length)
        drawing.lines!.push({ points: [...vertices, vertices[0]], strokeColor: '#16a34a', strokeDash: i ? '1 1' : undefined, strokeWidth: 0.2 })
    }
  }
  routeText(drawing, 2, 98, title, '#0f172a', 3)
  routeText(drawing, 2, 92, 'Board plan · x / y in mm · y points up')
  routeText(drawing, 2, 8, 'Blue: selected signal   Grey: neighbour   Green: ground / rail', '#475569', 1.8)
  routeText(
    drawing,
    2,
    4,
    `${selected.length} selected routes; ${Math.min(neighbours.length, 120)}/${neighbours.length} neighbour routes shown`,
    '#64748b',
    1.7,
  )
  return drawing
}

/** Colour is stable per electrical source, including all segments of a bent net. */
export function routeSectionDrawing(circuit: CircuitJson, geometry: SectionGeometry, scope: CopperScope, title: string): GraphicsObject {
  const drawing = routeBoardDrawing(circuit, scope, title)
  const selected = geometry.wires.filter((wire) => scope.selectedPcbTraceIds.includes(wire.trace))
  const sources = [...new Set(selected.map((wire) => wire.source))]
  const colors = ['#2563eb', '#0891b2', '#e11d48', '#4f46e5', '#a16207', '#0d9488']
  const wires = [
    ...routeDisplayItems(
      geometry.wires.filter((wire) => !scope.selectedPcbTraceIds.includes(wire.trace)),
      160,
    ),
    ...routeDisplayItems(selected, 2000),
  ]
  drawing.lines!.push(
    ...wires.map((wire) => ({
      points: [routeBoardPoint(circuit, wire.a), routeBoardPoint(circuit, wire.b)],
      strokeColor: scope.nonReferenceRailTraceIds.includes(wire.trace)
        ? '#16a34a'
        : sources.includes(wire.source)
          ? colors[sources.indexOf(wire.source) % colors.length]
          : '#cbd5e1',
      strokeWidth: sources.includes(wire.source) ? 0.45 : 0.1,
    })),
  )
  drawing.points = routeDisplayItems(
    wires.flatMap((wire) => (wire.joins ?? []).flatMap((join) => [join.from, join.to])),
    160,
  ).map((point) => ({ ...routeBoardPoint(circuit, point), color: '#d946ef' }))
  drawing.circles = routeDisplayItems(geometry.viaContacts).map((contact) => ({
    center: routeBoardPoint(circuit, contact.point),
    radius: 0.65,
    stroke: '#f97316',
  }))
  for (const [i, source] of sources.slice(0, 6).entries())
    routeText(drawing, 2 + (i % 2) * 49, 24 - Math.floor(i / 2) * 4, routeNetLabel(circuit, source).slice(0, 35), colors[i % colors.length], 1.7)
  // Replace the admission legend: segmented wires are coloured by net here.
  drawing.texts = drawing.texts!.filter((text) => text.y !== 8)
  routeText(drawing, 2, 8, 'Net colours above · Orange: via · Magenta: join · Green: pour', '#475569', 1.8)
  routeText(drawing, 2, 87, `${geometry.wires.length} wire sections · ${geometry.slices.length} field slices · ${geometry.viaContacts.length} via contacts`)
  return drawing
}

/** A transverse amber band at the exact midpoint of the current parallel slice. */
export function routeSliceDrawing(drawing: GraphicsObject, circuit: CircuitJson, slice: RouteSlice): void {
  if (!slice.wires.length) return
  const middle = (slice.start + slice.end) / 2
  const first = slice.wires[0]
  const low = Math.min(...slice.wires.map((wire) => wire.transverse - wire.width / 2)) - 0.15
  const high = Math.max(...slice.wires.map((wire) => wire.transverse + wire.width / 2)) + 0.15
  const points = [
    [middle - 0.06, low],
    [middle + 0.06, low],
    [middle + 0.06, high],
    [middle - 0.06, high],
  ].map(([position, transverse]) => routeBoardPoint(circuit, routePosition({ ...first, transverse }, position)))
  drawing.polygons ??= []
  drawing.polygons.push({ points, fill: '#fbbf24', stroke: '#d97706', strokeWidth: 0.2 })
  const point = routeBoardPoint(circuit, routePosition(first, middle))
  drawing.lines!.push({ points: [point, { x: 57, y: 36 }], strokeColor: '#d97706', strokeWidth: 0.15 })
  routeText(drawing, 57, 34, 'Amber band: current slice', '#a16207', 1.8)
}
