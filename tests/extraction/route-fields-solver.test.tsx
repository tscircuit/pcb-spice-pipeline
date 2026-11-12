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

test('two-trace TSX route-fields-solver visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RouteFieldsSolver>('RouteFieldsSolver')!.visualize(), 'extraction', 'route-fields-solver')
})

test('field drawing explains physical materials and self/mutual units without hover labels', async () => {
  const { root } = await routedVisualFixture()
  const drawing = root.getSolver<RouteFieldsSolver>('RouteFieldsSolver')!.visualize()
  const labels = drawing.texts!.filter(text => /^(Mask|Dielectric) εr=/.test(text.text)).sort((a, b) => b.y - a.y)
  assert.ok(labels.every(text => text.x > 292), 'layer labels sit outside thin slabs')
  assert.ok(labels.slice(1).every((text, i) => labels[i].y - text.y >= 6), 'layer labels cannot collide')
  assert.ok(drawing.rects!.some((rect) => rect.fill === '#fef3c7'))
  assert.ok(drawing.rects!.some((rect) => rect.fill === '#cffafe'))
  assert.ok(drawing.rects!.filter((rect) => rect.fill === '#2563eb').every((rect) => rect.height > 1))
  for (const label of ['εr=', 'pF/m', 'nH/m', 'Z0', 'Ω', 'delay', 'Reference:', 'Cm', 'Lm', 'k='])
    assert.ok(
      drawing.texts!.some((text) => text.text.includes(label)),
      label,
    )
  assert.ok(
    drawing.polygons!.some((line) => line.stroke === '#9333ea'),
    'coupling is in front of material fills in SVG and canvas',
  )
})
