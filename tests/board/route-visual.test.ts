import test from 'node:test'
import assert from 'node:assert/strict'
import type { GraphicsObject } from 'graphics-debug'
import { routeBoardDrawing, routeDisplayItems, routeFrame, routeMarks, routeStrip, routeStroke, routeView, type CircuitJson } from '../../src/board'
import { routedCopper } from '../support/routed-fixture'
import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('nets follow electrical connectivity, and one camera frames the copper, its endpoint parts and a pane slot', async () => {
  const { root } = await routedVisualFixture()
  const { circuitJson, scope } = root.stageOutput('RouteSectionsSolver').value[0]
  const view = routeView(circuitJson, scope)
  const nets = new Set(view.sources.values())
  assert.equal(nets.size, 2)
  assert.notEqual([...nets][0].hue, [...nets][1].hue)
  assert.equal(routeView(circuitJson, scope), view, 'cached per problem, so every stage shares it')
  const { focus, pane, camera } = view
  assert.ok(pane.minX >= focus.maxX || pane.maxY <= focus.minY, 'the pane sits beside the focus, never on it')
  assert.deepEqual(camera, { minX: Math.min(focus.minX, pane.minX), maxX: Math.max(focus.maxX, pane.maxX), minY: Math.min(focus.minY, pane.minY), maxY: Math.max(focus.maxY, pane.maxY) })
  const drawing = routeBoardDrawing(circuitJson, scope)
  assert.equal(drawing.rects![0].label, 'camera')
  assert.equal(drawing.texts!.length, 0, 'no captions or legends')
  assert.ok(drawing.lines!.every((line) => line.strokeWidth === 0.1 && line.label), 'real copper width, labelled with its net for hover')
  const copper = await routedCopper()
  assert.equal(new Set(routeView(copper.circuitJson, copper.scope).sources.values()).size, 1, 'a neighbour is context, not a net')
  assert.deepEqual(routeBoardDrawing(circuitJson, undefined).lines, [], 'without a scope nothing is overlaid, so the whole board shows')
})

test('a differential channel colours its two nets as two shades of one hue and carries its bit period', async () => {
  const { root } = await routedVisualFixture()
  const { circuitJson, scope } = root.stageOutput('RouteSectionsSolver').value[0]
  const selected = new Set(circuitJson.flatMap((record) => (record.type === 'pcb_trace' && scope.selectedPcbTraceIds.includes(record.pcb_trace_id) ? [record.source_trace_id] : [])))
  const ports = circuitJson.flatMap((record) => (record.type === 'source_trace' && selected.has(record.source_trace_id) ? [record.connected_source_port_ids] : []))
  const signal = { type: 'simulation_signal', simulation_signal_id: 'pair', simulation_signal_integrity_id: 'block', name: 'PAIR', driver: { p_source_port_id: ports[0][0], n_source_port_id: ports[1][0] }, receivers: [{ p_source_port_id: ports[0][1], n_source_port_id: ports[1][1] }], bit_rate_bps: 1e8, pattern: '01', seed: 1, offset_s: 0 }
  const view = routeView([...circuitJson.filter((record) => record.type !== 'simulation_digital_stimulus'), signal] as CircuitJson, { ...scope })
  const [p, n] = [...new Set(view.sources.values())]
  assert.equal(p.hue, n.hue)
  assert.notEqual(p.lightness, n.lightness)
  assert.deepEqual([p.label, n.label, p.unitInterval, p.differential], ['PAIR P', 'PAIR N', 1e-8, true])
})

test('the pane goes on the side that brings the camera nearest 1.6:1', () => {
  const tall = routeFrame({ minX: 0, maxX: 10, minY: 0, maxY: 30 })
  assert.ok(tall.pane.minX > tall.focus.maxX)
  const wide = routeFrame({ minX: 0, maxX: 30, minY: 0, maxY: 2 })
  assert.ok(wide.pane.maxY < wide.focus.minY)
  for (const frame of [tall, wide]) {
    const aspect = (frame.camera.maxX - frame.camera.minX) / (frame.camera.maxY - frame.camera.minY)
    assert.ok(aspect > 1.2 && aspect < 2.2, `aspect ${aspect}`)
  }
})

test('the layer is in the stroke: top solid, inner hollow, bottom dimmed', () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
  assert.equal(routeStroke(points, 'red', 0.2, 'top').length, 1)
  const [inner, core] = routeStroke(points, 'red', 0.2, 'inner2')
  assert.ok(core.strokeWidth! < inner.strokeWidth!)
  const [, shade] = routeStroke(points, 'red', 0.2, 'bottom')
  assert.equal(shade.strokeWidth, 0.2)
})

test('pin marks never grow past half their closest spacing, and sit on a dark halo', () => {
  const drawing: GraphicsObject = { polygons: [] }
  routeMarks(drawing, [{ point: { x: 0, y: 0 }, color: 'red', driver: true }, { point: { x: 0.8, y: 0 }, color: 'red', driver: false }], 10)
  assert.equal(drawing.polygons!.length, 4)
  const [first, second] = [drawing.polygons!.slice(0, 2), drawing.polygons!.slice(2)].map((marks) => marks.flatMap((polygon) => polygon.points.map((point) => point.x)))
  assert.ok(Math.max(...first) < Math.min(...second), 'halos never touch')
})

test('the strip unrolls nets to scale, centred in the pane, with one length label', async () => {
  const { root } = await routedVisualFixture()
  const { circuitJson, scope } = root.stageOutput('RouteSectionsSolver').value[0]
  const view = routeView(circuitJson, scope)
  const drawing: GraphicsObject = { lines: [], polygons: [], texts: [] }
  const nets = [...new Set(view.sources.values())]
  routeStrip(drawing, view.pane, [{ net: nets[0], length: 8 }, { net: nets[1], length: 4 }])
  const bars = drawing.lines!.filter((line) => line.label)
  const [long, short] = bars.map((line) => line.points[1].x - line.points[0].x)
  assert.ok(Math.abs(long / short - 2) < 1e-9)
  const middle = (view.pane.minY + view.pane.maxY) / 2
  assert.ok(Math.abs((bars[0].points[0].y + bars[1].points[0].y) / 2 - middle) < 1e-9)
  assert.ok(drawing.texts!.some((text) => text.text === '8.00 mm'))
})

test('two-trace TSX board drawing SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  const sections = root.stageOutput('RouteSectionsSolver').value[0]
  assertRouteVisual(routeBoardDrawing(root.inputProblem.circuitJson, sections.scope), 'board', 'route-visual-board')
})

test('display sampling bounds object counts and preserves the first and last item', () => {
  const items = Array.from({ length: 10000 }, (_, i) => i)
  const shown = routeDisplayItems(items)
  assert.equal(shown.length, 160)
  assert.equal(shown[0], 0)
  assert.equal(shown.at(-1), 9999)
  assert.equal(items.length, 10000, 'solver inputs are never thinned')
})
