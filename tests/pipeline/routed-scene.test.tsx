import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedPipelineSolver, routedScene } from '../../src/pipeline'
import { routedSceneFixture } from '../support/routed-scene-fixture'

test('every real TSX pipeline iteration retains a nonempty physical scene and finite camera target', async () => {
  const { root: fixture } = await routedSceneFixture(2)
  const root = new RoutedPipelineSolver(fixture.inputProblem, fixture.context)
  let count = 0
  do {
    for (let step = 0; step <= 6; step++) {
      const scene = routedScene(root, step)
      assert.ok(scene.circuitJson.some(record => record.type === 'pcb_board'))
      assert.ok(scene.routes.length > 0)
      assert.ok(scene.camera.target.every(Number.isFinite))
      assert.ok(scene.camera.position.every(Number.isFinite))
      assert.equal(scene.circuitJson.filter(record => record.type === 'pcb_component').length, fixture.inputProblem.circuitJson.filter(record => record.type === 'pcb_component').length)
    }
    if (root.solved) break
    await root.stepAsync()
    assert.ok(++count < 100, 'bounded serial stepping')
  } while (!root.failed)
  assert.equal(root.solved, true)
  assert.ok(count >= 12)
})
