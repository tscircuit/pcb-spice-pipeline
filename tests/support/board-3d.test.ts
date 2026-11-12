import test from 'node:test'
import assert from 'node:assert/strict'
import { spatialVoltage } from '../../site/board-3d/state'
import { copperRoutes, fullCopper } from '../../site/board-3d/copper'
import { boardPosition, stackupFromCircuitJson } from '../../src/board'
import { routedProblem, routedCopper } from './routed-fixture'
import { RoutedPipelineSolver } from '../../src/pipeline'
import { boardStageState } from '../../site/board-3d/state'

test('spatial display interpolates native nonuniform times and preserves every point vector', () => {
  const waveform = {
    points: [{ node: 'n0', net: 'signal', layer: 'inner1', x: 2, y: 3 }],
    timeSeconds: [0, 1e-9, 4e-9],
    volts: [[0, 2, 5]],
  }
  assert.equal(spatialVoltage(waveform, 0, 0.5e-9), 1)
  assert.equal(spatialVoltage(waveform, 0, 2e-9), 3)
  assert.equal(spatialVoltage(waveform, 0, -1), 0)
  assert.equal(spatialVoltage(waveform, 0, 1), 5)
  assert.equal(spatialVoltage(waveform, 1, 0), undefined)
  assert.equal(spatialVoltage({ ...waveform, volts: [[0]] }, 0, 0), undefined)
})

test('complete board copper includes both selected and unselected TSX routes at physical depths', async () => {
  const { circuitJson, scope } = await routedCopper()
  const stack = stackupFromCircuitJson(circuitJson)
  const routes = copperRoutes(circuitJson)
  assert.ok(routes.some((route) => scope.selectedPcbTraceIds.includes(route.trace)))
  assert.ok(routes.some((route) => !scope.selectedPcbTraceIds.includes(route.trace)))
  // This fixture deliberately has no CAD/pcb component bodies, so fullCopper needs no canvas for labels.
  const copper = fullCopper(
    circuitJson.filter((record) => record.type !== 'pcb_component'),
    stack,
  )
  assert.ok(copper.children.length >= routes.length + circuitJson.filter((record) => record.type === 'pcb_copper_pour').length)
  for (const [index, route] of routes.entries()) {
    const mesh = copper.children[index]
    const a = boardPosition(stack, ...route.a, route.layer)
    const b = boardPosition(stack, ...route.b, route.layer)
    assert.deepEqual(
      mesh.position.toArray(),
      a.map((value, axis) => (value + b[axis]) / 2),
    )
    assert.equal(mesh.frustumCulled, false)
  }
})

test('an initial stage reads no future solver output and never runs a native solver', async () => {
  const { circuitJson } = await routedCopper()
  const root = new RoutedPipelineSolver(
    { circuitJson, ibisSources: {} },
    {
      progress: (): void => undefined,
      runSolver: async (): Promise<never> => {
        throw new Error('must not execute')
      },
    },
  )
  assert.deepEqual(boardStageState(root, 0), { scopes: [], sections: [], fields: [], bindings: [], networks: [], captures: [] })
  assert.equal(root.iterations, 0)
})

test('a row completed directly by the debugger can be inspected before the root records it', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const root = new RoutedPipelineSolver(input, {
    progress: (): void => undefined,
    runSolver: async (): Promise<never> => {
      throw new Error('display must not execute')
    },
  })
  root.step()
  const admission = root.getSolver('RoutedAdmissionSolver')!
  admission.solve()
  const state = boardStageState(root, 1)
  assert.ok(state.scopes.length)
  assert.deepEqual(state.sections, [])
})
