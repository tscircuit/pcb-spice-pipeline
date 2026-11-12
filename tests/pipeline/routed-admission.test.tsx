import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedAdmissionSolver } from '../../src/pipeline'
import { prepareBlocks, prepareBlockById } from '../../src/pipeline/signals'
import { routedProblem } from '../support/routed-fixture'

test('admission uses shared block lowering, retains warnings and rejects invalid scope', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const [block] = prepareBlocks(input.circuitJson, input.ibisSources, '2d', 1)
  const single = prepareBlockById(input.circuitJson, input.ibisSources, block.block.simulation_signal_integrity_id, '2d', 1)
  assert.deepEqual(single.settings, block.settings)
  assert.deepEqual(single.circuit, block.circuit)
  assert.deepEqual(single.warnings, block.warnings)
  const solver = new RoutedAdmissionSolver(input)
  solver.step()
  assert.equal(solver.solved, true)
  assert.equal(solver.getOutput().value[0].sections.scope.selectedPcbTraceIds.length, 2)
  assert.ok(solver.visualize().points!.length >= 4)
  assert.throws(() => new RoutedAdmissionSolver({ ...input, scopeDistanceMm: 0 }).solve(), /scope distance/)
})

test('empty boards admit no fake blocks', () => {
  const solver = new RoutedAdmissionSolver({ circuitJson: [], ibisSources: {} })
  solver.solve()
  assert.deepEqual(solver.getOutput().value, [])
})
