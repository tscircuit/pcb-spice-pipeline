import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedAdmissionSolver, RoutedBlockSolver } from '../../src/pipeline'
import { RouteNetworkSolver } from '../../src/simulation'
import { routedProblem } from '../support/routed-fixture'

test('network owns real ladder node samples, complete probe evidence and the executable deck', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const port = { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('network test must not run ngspice')
  } }
  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  const block = new RoutedBlockSolver({ ...admission.getOutput().value[0], context: port })
  block.solveUntilStage('RouteTransientSolver')
  const network = block.getSolver<RouteNetworkSolver>(RouteNetworkSolver.name)!
  const output = network.getOutput().value
  assert.ok(network.iterations >= 3)
  assert.ok(output.evidence.cells)
  assert.ok(output.evidence.maximum_cell_delay_s)
  assert.ok(output.deck.includes('RBIAS'))
  assert.equal(output.probes.length, 3, 'two receivers and the existing rail monitor')
  assert.ok(network.visualize().lines!.some((line) => line.strokeColor === '#f59e0b'))
  assert.ok((output.evidence.warnings as string[]).some((warning) => warning.includes('candidate channel experiment')))
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('two-trace TSX route-network visual SVG snapshot', async () => {
  const { block } = await routedVisualFixture()
  assertRouteVisual(block.getSolver<RouteNetworkSolver>('RouteNetworkSolver')!.visualize(), 'simulation', 'route-network')
})

test('rejected network drawing retains physical context and shows its red reason', async () => {
  const { block } = await routedVisualFixture()
  const params = block.getSolver<RouteNetworkSolver>('RouteNetworkSolver')!.getConstructorParams()[0]
  const rejected = new RouteNetworkSolver(params)
  // Drawing-only failure state; the real DDR render separately exercises the 1,024-cell admission gate.
  rejected.failed = true
  rejected.error = 'Route ladder requires 1835 cells; exceeds modest-memory limit of 1024'
  const drawing = rejected.visualize()
  assert.ok(drawing.texts!.some((text) => text.color === '#dc2626' && text.text.includes('1835')))
  assertRouteVisual(drawing, 'simulation', 'route-network-rejected')
})
