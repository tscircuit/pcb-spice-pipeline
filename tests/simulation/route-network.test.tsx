import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedPipelineSolver, RoutedBlockSolver } from '../../src/pipeline'
import { RouteNetworkSolver } from '../../src/simulation'
import { routedProblem } from '../support/routed-fixture'

test('network owns real ladder node samples, complete probe evidence and the executable deck', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input)
  solver.solve()
  const block = solver.getSolver<RoutedBlockSolver>(solver.pipelineDef[1].solverName)!
  const network = block.getSolver<RouteNetworkSolver>(RouteNetworkSolver.name)!
  const output = network.getOutput().value
  assert.ok(network.iterations >= 3)
  assert.ok(output.evidence.cells)
  assert.ok(output.evidence.maximum_cell_delay_s)
  assert.ok(output.deck.includes('RBIAS'))
  assert.equal(output.probes.length, 3, 'two receivers and the existing rail monitor')
  assert.ok(network.visualize().lines!.some(line => line.strokeColor === '#f59e0b'))
  assert.ok((output.evidence.warnings as string[]).some(warning => warning.includes('candidate channel experiment')))
})
