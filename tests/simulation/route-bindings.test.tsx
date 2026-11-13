import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedAdmissionSolver, RoutedStageSolver } from '../../src/pipeline'
import { RouteSectionsSolver } from '../../src/board'
import { RouteBindingsSolver, type RouteBindingsInput, type RoutedBindings } from '../../src/simulation'
import { routedProblem } from '../support/routed-fixture'

test('bindings compile one buffer per step and freeze the fully allocated node map', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  const plan = admission.getOutput().value[0]
  const sections = new RouteSectionsSolver(plan.sections)
  sections.solve()
  const solver = new RouteBindingsSolver({ ...plan.bindings, scope: sections.getOutput().value.scope })
  solver.step()
  assert.equal(solver.stats.models, 1)
  assert.equal(solver.solved, false)
  solver.solve()
  const output = solver.getOutput()
  assert.equal(output.value.models.length, 4)
  assert.ok(output.value.models.every((model) => Object.values(model.spicePinMapping).every((port) => output.value.nodeMap[port] !== undefined)))
  assert.ok(Object.isFrozen(output.value.nodeMap))
  const glyphs = solver.visualize().polygons!.filter((polygon) => polygon.points.length === 3)
  assert.equal(glyphs.length, 8, 'a glyph at each lane end on the board and in the strip')
  assert.equal(glyphs.filter((glyph) => glyph.fill !== routeTones.halo).length, 4, 'drivers are filled')
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'
import { routeTones } from '../../src/board'

test('two-trace TSX route-bindings visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RouteBindingsSolver>('RouteBindingsSolver')!.visualize(), 'simulation', 'route-bindings')
})

test('missing IBIS bytes mark physical endpoints and rejection reason red', async () => {
  const { root } = await routedVisualFixture()
  const params = root.getSolver<RoutedStageSolver<RouteBindingsInput, RoutedBindings>>('RouteBindingsSolver')!.getConstructorParams()[0][0]
  const missing = new RouteBindingsSolver({ ...params, ibisSources: {} })
  assert.throws(() => missing.solve())
  const drawing = missing.visualize()
  assert.ok(drawing.polygons!.some((outline) => outline.stroke === routeTones.failure), 'unbound parts are outlined red')
  assert.ok(drawing.texts!.some((text) => text.color === routeTones.failure && text.text.includes('model')))
  assertRouteVisual(drawing, 'simulation', 'route-bindings-missing')
})
