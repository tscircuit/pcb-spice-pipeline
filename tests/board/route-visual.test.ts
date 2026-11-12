import test from 'node:test'
import assert from 'node:assert/strict'
import { boardBounds, routeBoardDrawing, routeSectionDrawing, routeDisplayItems, routeFocus, routeTextSize, routeTitle, routeSourceColors } from '../../src/board'
import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'
import { edgeBoard, assertDrawable } from '../support/edge-boards'

test('focus is the padded box of the points, never smaller than half the board, else the whole board', () => {
  const board = { minX: -50, maxX: 50, minY: -20, maxY: 20 }
  assert.deepEqual(routeFocus([], board), board)
  const focus = routeFocus([{ x: 1, y: 1 }, { x: 3, y: 2 }], board)
  assert.ok(focus.minX < 1 && focus.maxX > 3 && focus.minY < 1 && focus.maxY > 2)
  assert.ok(focus.maxX - focus.minX >= 50, 'small work keeps board context')
  const wide = routeFocus([{ x: -40, y: 0 }, { x: 40, y: 0 }], board)
  assert.ok(wide.maxX - wide.minX > 80)
})

test('text scales with the view box so labels read the same on any board size', () => {
  const small = routeTextSize({ minX: 0, maxX: 10, minY: 0, maxY: 5 })
  const large = routeTextSize({ minX: 0, maxX: 1000, minY: 0, maxY: 500 })
  assert.ok(Math.abs(large.body / small.body - 100) < 1e-9)
  assert.ok(small.title > small.body)
})

test('board drawing is the real board in mm with the selected copper exactly on its trace', async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const sections = root.stageOutput('RouteSectionsSolver').value[0]
  const drawing = routeBoardDrawing(circuit, sections.scope)
  const selected = circuit.find((record) => record.type === 'pcb_trace' && sections.scope.selectedPcbTraceIds.includes(record.pcb_trace_id))!
  assert.equal(selected.type, 'pcb_trace')
  const first = (selected.type === 'pcb_trace' ? selected.route[0] : undefined) as { x: number; y: number } | undefined
  assert.ok(drawing.lines!.some((line) => line.zIndex === 2 && line.points[0].x === first!.x && line.points[0].y === first!.y), 'overlay starts on the copper')
  const bounds = boardBounds(circuit)
  assert.ok(drawing.focus!.minX >= bounds.minX - (bounds.maxX - bounds.minX) && drawing.focus!.maxX <= bounds.maxX + (bounds.maxX - bounds.minX))
  assertRouteVisual(routeTitle(drawing, 'Board copper'), 'board', 'route-visual-board')
  const sectionDrawing = routeSectionDrawing(circuit, sections.geometry, sections.scope)
  assertRouteVisual(sectionDrawing, 'board', 'route-visual-sections')
  assert.equal(new Set(routeSourceColors(sections.geometry, sections.scope).values()).size, 2, 'each electrical source has a distinct colour')
})

test('board drawing works on arbitrary boards with nothing selected', () => {
  for (const circuit of [edgeBoard({ layers: 1 }), edgeBoard({ layers: 6, outline: true }), edgeBoard({ pours: false, parts: false })]) {
    const drawing = routeTitle(routeBoardDrawing(circuit, undefined), '0 · Board')
    assertDrawable(drawing, 'edge board')
    const bounds = boardBounds(circuit)
    assert.deepEqual({ ...drawing.focus, maxY: bounds.maxY }, bounds, 'whole board, plus a title band above it')
    assert.ok(drawing.focus!.maxY > bounds.maxY)
  }
})

test('display sampling bounds object counts and preserves the first and last item', () => {
  const items = Array.from({ length: 10000 }, (_, i) => i)
  const shown = routeDisplayItems(items)
  assert.equal(shown.length, 160)
  assert.equal(shown[0], 0)
  assert.equal(shown.at(-1), 9999)
  assert.equal(items.length, 10000, 'solver inputs are never thinned')
})
