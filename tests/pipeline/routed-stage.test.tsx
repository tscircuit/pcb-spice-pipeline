import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedStageSolver } from '../../src/pipeline'
import { RouteSectionsSolver, type RouteSectionsInput, type RoutedSections } from '../../src/board'
import { RouteTransientSolver, type RoutedCapture } from '../../src/simulation'
import { routedSceneFixture } from '../support/routed-scene-fixture'

test('a flat stage drains real TSX block inputs in order and retains the last drawing', async () => {
  const { root } = await routedSceneFixture(2)
  const inputs = root.getSolver<RoutedStageSolver<RouteSectionsInput, RoutedSections>>('RouteSectionsSolver')!.getConstructorParams()[0]
  const stage = new RoutedStageSolver([...inputs].reverse(), RouteSectionsSolver)
  stage.step()
  assert.equal(stage.stats.completedBlocks, 0, 'one step cannot consume an entire multi-route block')
  assert.throws(() => stage.getOutput(), /incomplete/)
  stage.solve()
  assert.deepEqual(stage.getOutput().value, [...root.stageOutput('RouteSectionsSolver').value].reverse())
  assert.equal(stage.getOutput().artifacts.length, 4)
  assert.equal(stage.stats.completedBlocks, 2)
  assert.equal(stage.progress, 1)
  const last = new RouteSectionsSolver(inputs[0])
  last.solve()
  assert.equal(stage.activeSubSolver, undefined)
})

test('an empty transient stage completes synchronously without invoking the runtime', () => {
  const stage = new RoutedStageSolver([], RouteTransientSolver)
  stage.solve()
  assert.deepEqual(stage.getOutput(), { value: [], artifacts: [] })
  assert.equal(stage.progress, 1)
})

test('a failing block stops the flat stage before later blocks or partial outputs', async () => {
  const { root } = await routedSceneFixture(2)
  type Input = ReturnType<RouteTransientSolver['getConstructorParams']>[0]
  const inputs = root.getSolver<RoutedStageSolver<Input, RoutedCapture>>('RouteTransientSolver')!.getConstructorParams()[0]
  let calls = 0
  const stage = new RoutedStageSolver(
    inputs.map((input) => ({
      ...input,
      context: {
        progress: (): void => undefined,
        runSolver: async () => {
          calls++
          throw new Error('bounded engine failure')
        },
      },
    })),
    RouteTransientSolver,
  )
  await assert.rejects(stage.solveAsync(), /bounded engine failure/)
  assert.equal(calls, 1)
  assert.equal(stage.failed, true)
  assert.match(stage.error!, /bounded engine failure/)
  assert.equal(stage.stats.completedBlocks, 0)
  assert.throws(() => stage.getOutput(), /incomplete/)
})
