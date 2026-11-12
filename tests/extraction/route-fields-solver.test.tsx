import test from 'node:test'
import type { StageDrawing } from '../../src/board'
import assert from 'node:assert/strict'
import { RouteFieldsSolver, routeCrossSection, solveCrossSection } from '../../src/extraction'
import { segmentRoutes } from '../../src/board'
import { routedCopper } from '../support/routed-fixture'

test('field steps reuse canonical pair geometry, preserve coefficients and publish no functions/cache', async () => {
  const { circuitJson, scope } = await routedCopper()
  const geometry = segmentRoutes(circuitJson, scope)
  const materials = { maskMm: 0.02, maskEr: 3.3, maskLoss: 0.025, substrateLoss: 0.02 }
  const solver = new RouteFieldsSolver({ geometry, materials, artifactPrefix: 'test' })
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.uniqueSolves, 1)
  solver.solve()
  const result = solver.getOutput()
  assert.equal(result.value.sections.length, 1)
  assert.equal(solver.stats.cacheHits, 1)
  assert.deepEqual(result.value.slices[0].line.C, solveCrossSection(routeCrossSection(geometry, geometry.slices[0], materials), { panelsPerEdge: 12 }).C)
  assert.equal('atFrequency' in result.value.slices[0].line, false)
  assert.ok(solver.visualize().rects!.length > 2)
  assert.ok(Object.isFrozen(result.value.slices[0].line.C))
  const repeat = new RouteFieldsSolver(JSON.parse(JSON.stringify(solver.getConstructorParams()[0])))
  repeat.solve()
  assert.deepEqual(repeat.getOutput().artifacts, result.artifacts)
  const invalid = new RouteFieldsSolver({
    geometry: { ...geometry, slices: [{ ...geometry.slices[0], wires: Array(41).fill(geometry.wires[0]) }] },
    artifactPrefix: 'test',
  })
  assert.throws(() => invalid.solve(), /limit of 40/)
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('two-trace TSX route-fields-solver visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RouteFieldsSolver>('RouteFieldsSolver')!.visualize(), 'extraction', 'route-fields-solver')
})

test('field drawing ties the amber board cut to its cross-section; results are numbers, not sentences', async () => {
  const { root } = await routedVisualFixture()
  const drawing: StageDrawing = root.getSolver<RouteFieldsSolver>('RouteFieldsSolver')!.visualize()
  const slice = root.stageOutput('RouteSectionsSolver').value[0].geometry.slices.at(-1)!
  const cut = drawing.lines!.find((line) => line.strokeColor === '#f59e0b' && line.zIndex === 3)!
  const middle = (slice.start + slice.end) / 2
  for (const point of cut.points) assert.ok(Math.abs(point.x * slice.wires[0].u[0] + point.y * slice.wires[0].u[1] - middle) < 1e-9, 'cut sits at the slice midpoint in board mm')
  assert.ok(drawing.lines!.some((line) => line.strokeColor === '#f59e0b' && line.strokeDash), 'leader from the cut to the panel')
  assert.ok(drawing.rects!.some((rect) => rect.fill === '#fef3c7'))
  assert.ok(drawing.rects!.some((rect) => rect.fill === '#cffafe'))
  assert.ok(drawing.texts!.some((text) => / Ω$/.test(text.text)), 'Z0 per conductor')
  assert.ok(drawing.texts!.some((text) => /^k \d/.test(text.text)), 'strongest coupling')
  assert.ok(drawing.polygons!.some((line) => line.stroke === '#9333ea'), 'coupling is in front of material fills in SVG and canvas')
  assert.ok(drawing.focus!.maxX > cut.points[0].x && drawing.focus!.minX <= cut.points[0].x, 'camera covers the cut and its panel')
})
