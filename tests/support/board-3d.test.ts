import test from 'node:test'
import assert from 'node:assert/strict'
import { spatialVoltage, spatialRouteIndices } from '../../site/board-3d/state'
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
    const mesh = copper.children.filter(object => object.userData.kind === 'copper')[index]
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
  assert.deepEqual(boardStageState(root, 0).scopes, [])
  assert.ok(boardStageState(root, 0).camera.target.every(Number.isFinite))
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

test('the spatial contract colours actual routed copper and remains gated by the selected stage', async () => {
  const { stageOverlay } = await import('../../site/board-3d/overlay')
  const { voltageColor } = await import('../../site/board-3d/state')
  const { circuitJson } = await routedCopper()
  const stack = stackupFromCircuitJson(circuitJson)
  const route = copperRoutes(circuitJson)[0]
  const spatial = {
    points: [route.a, route.b].map(([x, y], i) => ({ node: `native-node-${i}`, net: route.net, layer: route.layer, x, y })),
    timeSeconds: [0, 1e-9, 4e-9],
    volts: [
      [0, 2, 5],
      [1, 3, 4],
    ],
  }
  // Synthetic native-output-shaped fixture verifies the consumer; it is not engine evidence.
  const state = {
    scopes: [],
    sections: [],
    fields: [],
    bindings: [],
    networks: [],
    circuitJson,
    camera: boardStageState(new RoutedPipelineSolver({ circuitJson, ibisSources: {} }, { progress: (): void => undefined, runSolver: async (): Promise<never> => { throw new Error('no native') } }), 0).camera,
    routes: [],
    captures: [
      {
        kind: 'completed' as const,
        qualification: 'candidate-unqualified' as const,
        timestampsSeconds: spatial.timeSeconds,
        probes: [],
        spatial,
      },
    ],
  }
  const overlay = stageOverlay(circuitJson, stack, state, 6, 0, 0.5, 0.5e-9)
  const samples = overlay.children.filter((object) => object.userData.spatial)
  assert.ok(samples.length > 0)
  assert.ok(samples.every((object) => object.position.z === boardPosition(stack, 0, 0, route.layer)[2]))
  for (const sample of samples) {
    assert.equal(sample.userData.spatial, spatial)
    assert.ok([0, 1].includes(sample.userData.blend.before))
    assert.ok([0, 1].includes(sample.userData.blend.after))
    assert.ok(sample.userData.blend.fraction >= 0 && sample.userData.blend.fraction <= 1)
  }
  assert.equal(stageOverlay(circuitJson, stack, state, 5, 0, 0.5, 0.5e-9).children.filter((object) => object.userData.spatial).length, 0)
  assert.notEqual(voltageColor(0), voltageColor(3.3))
})

test('native channel labels map to PCB copper by node identity without mixing differential legs', async () => {
  const { circuitJson } = await routedCopper()
  const route = copperRoutes(circuitJson)[0]
  const trace = circuitJson.find((record) => record.type === 'pcb_trace' && record.pcb_trace_id === route.trace)!
  if (trace.type !== 'pcb_trace') throw new Error('Missing trace')
  const source = circuitJson.find((record) => record.type === 'source_trace' && record.source_trace_id === trace.source_trace_id)!
  if (source.type !== 'source_trace') throw new Error('Missing source')
  const points = [
    { node: 'n-p0', net: 'BUS:positive-port', layer: route.layer, x: route.a[0], y: route.a[1] },
    { node: 'n-p1', net: 'BUS:positive-port', layer: route.layer, x: route.b[0], y: route.b[1] },
    { node: 'n-n0', net: 'BUS:negative-port', layer: route.layer, x: route.a[0], y: route.a[1] + 0.35 },
  ]
  const waveform = {
    points,
    timeSeconds: [0, 1],
    volts: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  }
  assert.deepEqual(
    spatialRouteIndices(circuitJson, [{ nodeMap: { [source.connected_source_port_ids[0]]: 'n-p0' } }], waveform, route.trace),
    [0, 1],
  )
})
