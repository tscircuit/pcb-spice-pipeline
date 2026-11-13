import test from 'node:test'
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
import { routeTones } from '../../src/board'

test('two-trace TSX route-fields-solver visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RouteFieldsSolver>('RouteFieldsSolver')!.visualize(), 'extraction', 'route-fields-solver')
})

test('field drawing cuts the board at the slice and shows its stack in a pane, writing only Z0', async () => {
  const { root } = await routedVisualFixture()
  const drawing = root.getSolver<RouteFieldsSolver>('RouteFieldsSolver')!.visualize()
  assert.ok(drawing.polygons!.some((polygon) => polygon.fill === routeTones.slice), 'amber cut on the board')
  assert.ok(drawing.lines!.some((line) => line.zIndex === -1 && line.strokeColor === routeTones.pane), 'the pane is opaque over the board')
  const mapped = drawing.lines!.filter((line) => /^\d+ Ω$/.test(line.label ?? ''))
  assert.ok(mapped.length >= 2 && mapped.every((line) => line.strokeColor!.startsWith('rgb(')), 'solved copper is coloured by its Z0')
  assert.equal(drawing.rects!.filter((rect) => rect.fill?.startsWith('rgb(') && rect.width < 1).length >= 2, true, 'conductors share the Z0 scale')
  assert.ok(drawing.polygons!.some((polygon) => polygon.fill === routeTones.coupling), 'coupling band paints in front of the stack')
  assert.ok(drawing.texts!.every((text) => /^\d+ Ω$/.test(text.text)), 'only impedances are written')
})
