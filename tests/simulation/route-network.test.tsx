import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedPipelineSolver, RoutedStageSolver } from '../../src/pipeline'
import { RouteNetworkSolver, type RouteNetworkInput, type RoutedDeck } from '../../src/simulation'
import { routedProblem } from '../support/routed-fixture'

test('network owns real ladder node samples, complete probe evidence and the executable deck', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const port = { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('network test must not run ngspice')
  } }
  const root = new RoutedPipelineSolver(input, port)
  root.solveUntilStage('RouteTransientSolver')
  const network = root.getSolver(RouteNetworkSolver.name)!
  const output = root.stageOutput('RouteNetworkSolver').value[0]
  assert.ok(network.iterations >= 3)
  assert.ok(output.evidence.cells)
  assert.ok(output.evidence.maximum_cell_delay_s)
  assert.ok(output.deck.includes('RBIAS'))
  // klu_refactor reuses the first transient pivots; the zero-diagonal skin multiport rows need KLU tol 0.1.
  assert.match(output.deck, /^\.options klu .* pivrel=0\.1$/m)
  assert.equal(output.probes.length, 3, 'two receivers and the existing rail monitor')
  assert.ok(network.visualize().lines!.some((line) => line.strokeColor === routeTones.cell), 'ladder cells are ticks across the copper')
  assert.ok((output.evidence.warnings as string[]).some((warning) => warning.includes('candidate channel experiment')))
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'
import { routeTones } from '../../src/board'

test('two-trace TSX route-network visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RouteNetworkSolver>('RouteNetworkSolver')!.visualize(), 'simulation', 'route-network')
})

test('rejected network drawing retains physical context and shows its red reason', async () => {
  const { root } = await routedVisualFixture()
  const params = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0]
  const rejected = new RouteNetworkSolver(params)
  // Drawing-only failure state; the real DDR render separately exercises the 1,024-cell admission gate.
  rejected.failed = true
  rejected.error = 'Route ladder requires 1835 cells; exceeds modest-memory limit of 1024'
  const drawing = rejected.visualize()
  assert.ok(drawing.texts!.some((text) => text.color === routeTones.failure && text.text.includes('1835')))
  assertRouteVisual(drawing, 'simulation', 'route-network-rejected')
})
