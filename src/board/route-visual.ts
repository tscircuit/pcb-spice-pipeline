import type { GraphicsObject, Point } from 'graphics-debug'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import type { RouteXY, SectionGeometry } from './route-sections'

/** Board millimetres fitted into the shared 0..100 atlas panel, positive y upward. */
export function routeBoardPoint(circuit: CircuitJson, point: RouteXY): Point {
  const board = circuit.find(record => record.type === 'pcb_board')
  const scale = 90 / Math.max(board?.width ?? 1, board?.height ?? 1)
  return { x: 50 + (point[0] - (board?.center.x ?? 0)) * scale, y: 50 + (point[1] - (board?.center.y ?? 0)) * scale }
}

/** Actual route spans, capped only for display; selected copper and references stay visible. */
export function routeBoardDrawing(circuit: CircuitJson, scope: CopperScope | undefined, title: string): GraphicsObject {
  const traces = circuit.filter(record => record.type === 'pcb_trace')
  const selected = traces.filter(trace => scope?.selectedPcbTraceIds.includes(trace.pcb_trace_id))
  const neighbours = traces.filter(trace => !selected.includes(trace)).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 200)) === 0)
  const lines: NonNullable<GraphicsObject['lines']> = []
  for (const trace of [...neighbours, ...selected]) for (let i = 1; i < trace.route.length; i++) {
    const a = trace.route[i - 1]
    const b = trace.route[i]
    if (!('x' in a) || !('x' in b)) continue
    lines.push({ points: [routeBoardPoint(circuit, [a.x, a.y]), routeBoardPoint(circuit, [b.x, b.y])], strokeColor: scope?.nonReferenceRailTraceIds.includes(trace.pcb_trace_id) ? '#16a34a' : selected.includes(trace) ? '#2563eb' : '#cbd5e1', strokeWidth: selected.includes(trace) ? .45 : .12 })
  }
  for (const pour of circuit.filter(record => record.type === 'pcb_copper_pour')) {
    if (pour.shape !== 'brep') continue
    for (const [i, ring] of [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings].entries()) {
      const vertices = ring.vertices.map(point => routeBoardPoint(circuit, [point.x, point.y]))
      if (vertices.length) lines.push({ points: [...vertices, vertices[0]], strokeColor: '#16a34a', strokeDash: i ? '1 1' : undefined, strokeWidth: .15 })
    }
  }
  return { coordinateSystem: 'cartesian', lines, texts: [{ x: 0, y: 100, text: title, fontSize: 2.3 }], points: [], circles: [], rects: [] }
}

/** Add real segmented wires, joins and pour rings to the board atlas. */
export function routeSectionDrawing(circuit: CircuitJson, geometry: SectionGeometry, scope: CopperScope, title: string): GraphicsObject {
  const drawing = routeBoardDrawing(circuit, scope, title)
  const selected = geometry.wires.filter(wire => scope.selectedPcbTraceIds.includes(wire.trace))
  const neighbours = geometry.wires.filter(wire => !scope.selectedPcbTraceIds.includes(wire.trace)).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 200)) === 0)
  const wires = [...neighbours, ...selected]
  drawing.lines = wires.map(wire => ({ points: [routeBoardPoint(circuit, wire.a), routeBoardPoint(circuit, wire.b)], strokeColor: scope.nonReferenceRailTraceIds.includes(wire.trace) ? '#16a34a' : scope.selectedPcbTraceIds.includes(wire.trace) ? ['#2563eb', '#06b6d4'][wire.id % 2] : '#cbd5e1', strokeWidth: .3 }))
  for (const pour of geometry.pours) for (const [i, ring] of pour.polygon.entries()) drawing.lines.push({ points: [...ring, ring[0]].map(point => routeBoardPoint(circuit, point)), strokeColor: '#16a34a', strokeDash: i ? '1 1' : undefined, strokeWidth: .15 })
  drawing.points = wires.flatMap(wire => (wire.joins ?? []).flatMap(join => [join.from, join.to].map(point => ({ ...routeBoardPoint(circuit, point), color: '#d946ef' }))))
  drawing.circles = geometry.viaContacts.filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 200)) === 0).map(contact => ({ center: routeBoardPoint(circuit, contact.point), radius: .6, stroke: '#f97316' }))
  return drawing
}
