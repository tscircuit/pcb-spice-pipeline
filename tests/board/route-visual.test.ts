import test from 'node:test'
import assert from 'node:assert/strict'
import { routeBoardDrawing, routeBoardPoint, routeSectionDrawing, routeDisplayItems } from '../../src/board'
import { routedCopper } from '../support/routed-fixture'

test('board atlas fits physical mm and keeps y upward; selected routes retain their colour', async () => {
  const { circuitJson, scope } = await routedCopper()
  const origin = routeBoardPoint(circuitJson, [0, 0])
  assert.equal(origin.x, 50)
  assert.ok(routeBoardPoint(circuitJson, [0, 1]).y > origin.y)
  const drawing = routeBoardDrawing(circuitJson, scope, 'Admission')
  assert.ok(drawing.lines!.some((line) => line.strokeColor === '#2563eb'))
  assert.ok(drawing.lines!.every((line) => line.points.every((point) => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100)))
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'
import { RouteSectionsSolver } from '../../src/board'

test('two-trace TSX board and section drawing SVG snapshots', async () => {
  const { root, block } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const sections = block.getSolver<RouteSectionsSolver>('RouteSectionsSolver')!.getOutput().value
  assertRouteVisual(routeBoardDrawing(circuit, sections.scope, 'Board copper'), 'board', 'route-visual-board')
  const drawing = routeSectionDrawing(circuit, sections.geometry, sections.scope, 'Segmented copper')
  assertRouteVisual(drawing, 'board', 'route-visual-sections')
  const colors = sections.geometry.wires.map(
    (wire) =>
      drawing.lines!.find(
        (line) =>
          line.points[0].x === routeBoardPoint(circuit, wire.a).x && line.points[0].y === routeBoardPoint(circuit, wire.a).y && line.strokeWidth === 0.45,
      )!.strokeColor,
  )
  assert.equal(new Set(colors).size, 2, 'each electrical net has a distinct colour')
})

test('display sampling bounds object counts and preserves the first and last item', () => {
  const items = Array.from({ length: 10000 }, (_, i) => i)
  const shown = routeDisplayItems(items)
  assert.equal(shown.length, 160)
  assert.equal(shown[0], 0)
  assert.equal(shown.at(-1), 9999)
  assert.equal(items.length, 10000, 'solver inputs are never thinned')
})
