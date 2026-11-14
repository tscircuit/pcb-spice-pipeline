import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedAdmissionSolver } from '../../src/pipeline'
import { prepareBlockById, signalBlocks } from '../../src/pipeline/signals'
import { routedProblem } from '../support/routed-fixture'

test('admission uses shared block lowering, retains warnings and rejects invalid scope', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const [id] = signalBlocks(input.circuitJson).map(block => block.simulation_signal_integrity_id)
  const block = prepareBlockById(input.circuitJson, input.ibisSources, id, input.scopeDistanceMm)
  const solver = new RoutedAdmissionSolver(input)
  solver.step()
  assert.equal(solver.solved, true)
  const [plan] = solver.getOutput().value
  assert.deepEqual(plan.sections.circuitJson, block.circuit)
  assert.deepEqual(plan.sections.scope, block.settings.copperScope)
  assert.deepEqual(plan.warnings, block.warnings)
  assert.equal(solver.getOutput().value[0].sections.scope.selectedPcbTraceIds.length, 2)
  const drawing = solver.visualize()
  const marks = drawing.polygons!.filter((polygon) => polygon.label && polygon.points.length > 4 && polygon.fill !== '#0b0f13')
  assert.equal(marks.filter((mark) => mark.fill).length, 2, 'each driver is a filled dot')
  assert.equal(marks.filter((mark) => !mark.fill).length, 2, 'each receiver is a ring')
  assert.throws(() => new RoutedAdmissionSolver({ ...input, scopeDistanceMm: 0 }).solve(), /scope distance/)
})

test('empty boards admit no fake blocks', () => {
  const solver = new RoutedAdmissionSolver({ circuitJson: [], ibisSources: {} })
  solver.solve()
  assert.deepEqual(solver.getOutput().value, [])
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'
import { routeTones } from '../../src/board'

test('two-trace TSX routed-admission visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RoutedAdmissionSolver>('RoutedAdmissionSolver')!.visualize(), 'pipeline', 'routed-admission')
})

test('rejected admission carries a visible red reason without inventing an admitted block', async () => {
  const { root } = await routedVisualFixture()
  const solver = new RoutedAdmissionSolver({ ...root.inputProblem, scopeDistanceMm: 0 })
  assert.throws(() => solver.solve(), /scope distance/)
  const drawing = solver.visualize()
  assert.ok(drawing.texts!.every((text) => text.color === routeTones.failure), 'only the red reason is written')
  assert.match(drawing.texts!.map((text) => text.text).join(' '), /scope distance/)
  assertRouteVisual(drawing, 'pipeline', 'routed-admission-rejected')
})
