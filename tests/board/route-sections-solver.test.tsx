import test from 'node:test'
import assert from 'node:assert/strict'
import { RouteSectionsSolver, segmentRoutes } from '../../src/board'
import { routedCopper } from '../support/routed-fixture'

test('one route per section step preserves the original geometry and checks endpoint contacts', async () => {
  const { circuitJson, scope } = await routedCopper()
  const input = {
    circuitJson,
    scope,
    requiredSourcePortIds: [] as string[],
    referenceSourcePortId: circuitJson.find((record) => record.type === 'source_net')!.source_net_id,
    artifactPrefix: 'test',
  }
  const solver = new RouteSectionsSolver(input)
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.routes, 1)
  solver.solve()
  assert.deepEqual(solver.getOutput().value.geometry, segmentRoutes(circuitJson, scope))
  assert.ok(solver.visualize().lines!.length)
  const invalid = new RouteSectionsSolver({ ...input, requiredSourcePortIds: ['missing-port'] })
  assert.throws(() => invalid.solve(), /no physical wire or via contact/)
  assert.equal(invalid.failed, true)
  assert.throws(() => invalid.getOutput(), /incomplete/)
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('two-trace TSX route-sections-solver visual SVG snapshot', async () => {
  const { block } = await routedVisualFixture()
  assertRouteVisual(block.getSolver<RouteSectionsSolver>('RouteSectionsSolver')!.visualize(), 'board', 'route-sections-solver')
})
