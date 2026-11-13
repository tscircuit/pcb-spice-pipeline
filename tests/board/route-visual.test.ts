import test from 'node:test'
import type { GraphicsObject } from 'graphics-debug'
import assert from 'node:assert/strict'
import { routeBoardDrawing, routeClip, routeDisplayItems, routeMarks, routeSectionDrawing } from '../../src/board'
import { routedCopper } from '../support/routed-fixture'

test('board drawing keeps physical mm, real copper widths and one colour per selected net', async () => {
  const { circuitJson, scope } = await routedCopper()
  const drawing = routeBoardDrawing(circuitJson, scope)
  const selected = circuitJson.flatMap((record) => (record.type === 'pcb_trace' && scope.selectedPcbTraceIds.includes(record.pcb_trace_id) ? [record] : []))
  const copper = new Set(selected.flatMap((trace) => trace.route.flatMap((point) => (point.route_type === 'wire' ? [`${point.x},${point.y}`] : []))))
  assert.ok(drawing.lines!.every((line) => line.points.every((point) => copper.has(`${point.x},${point.y}`))), 'no atlas transform')
  assert.ok(drawing.lines!.every((line) => line.strokeWidth === 0.1), 'real trace width')
  assert.equal(new Set(drawing.lines!.map((line) => line.strokeColor)).size, selected.length)
  assert.equal(drawing.texts!.length, 0, 'no captions or legends')
  assert.deepEqual(routeBoardDrawing(circuitJson, undefined).lines, [], 'without a scope nothing is overlaid, so the whole board shows')
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('two-trace TSX board and section drawing SVG snapshots', async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const sections = root.stageOutput('RouteSectionsSolver').value[0]
  assertRouteVisual(routeBoardDrawing(circuit, sections.scope), 'board', 'route-visual-board')
  const drawing = routeSectionDrawing(circuit, sections.geometry, sections.scope, true)
  assertRouteVisual(drawing, 'board', 'route-visual-sections')
  const widths = new Set(sections.geometry.wires.map((wire) => wire.width))
  assert.equal(new Set(drawing.lines!.filter((line) => widths.has(line.strokeWidth!)).map((line) => line.strokeColor)).size, 2, 'each electrical net has a distinct colour')
})

test('context copper is cut to the focus box', () => {
  const [line, ...rest] = routeClip([{ points: [{ x: -5, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }], strokeWidth: 1 }], { minX: -1, maxX: 6, minY: -1, maxY: 1 })
  assert.deepEqual(line.points, [{ x: -1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }])
  assert.equal(rest.length, 0)
  assert.deepEqual(routeClip([{ points: [{ x: 9, y: 9 }, { x: 10, y: 9 }] }], { minX: 0, maxX: 1, minY: 0, maxY: 1 }), [])
})

test('pin marks never grow past half their closest spacing', () => {
  const drawing: GraphicsObject = { circles: [], polygons: [] }
  routeMarks(drawing, [{ point: { x: 0, y: 0 }, color: 'red', driver: true }, { point: { x: 0.8, y: 0 }, color: 'red', driver: false }], 10)
  assert.ok(drawing.circles![0].radius < 0.4)
  assert.ok(Math.max(...drawing.polygons![0].points.map((point) => point.x)) < 0.8 + 0.4)
})

test('display sampling bounds object counts and preserves the first and last item', () => {
  const items = Array.from({ length: 10000 }, (_, i) => i)
  const shown = routeDisplayItems(items)
  assert.equal(shown.length, 160)
  assert.equal(shown[0], 0)
  assert.equal(shown.at(-1), 9999)
  assert.equal(items.length, 10000, 'solver inputs are never thinned')
})
