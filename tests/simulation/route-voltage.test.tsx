import test from 'node:test'
import assert from 'node:assert/strict'
import { routedCopper } from '../support/routed-fixture'
import { boardRouteSegments, stackupFromCircuitJson } from '../../src/board'
import { routeVoltagePositions, routeVoltageBlend, routeVoltageAt, routeVoltageRange, routeFirstEdge } from '../../src/simulation'

test('sparse native nodes interpolate continuously in route distance and nonuniform time', async () => {
  const { circuitJson } = await routedCopper()
  const stack = stackupFromCircuitJson(circuitJson)
  const route = boardRouteSegments(circuitJson, stack).filter(
    (segment) => segment.trace === boardRouteSegments(circuitJson, stack)[0].trace,
  )
  const a = route[0].a
  const b = route.at(-1)!.b
  const waveform = {
    points: [a, b].map((point, i) => ({ node: `n${i}`, net: 'signal', x: point[0], y: point[1], layer: 'top' })),
    timeSeconds: [0, 1e-9, 4e-9],
    volts: [
      [0, 2, 5],
      [2, 4, 7],
    ],
  }
  const positions = routeVoltagePositions(route, stack, waveform, [0, 1])
  assert.equal(positions.length, 2)
  const middle = routeVoltageBlend(positions, route.at(-1)!.end / 2)!
  assert.equal(middle.fraction, 0.5)
  assert.equal(routeVoltageAt(waveform, middle, 0.5e-9), 2)
  assert.equal(routeVoltageAt(waveform, middle, 2e-9), 4)
  assert.equal(routeVoltageAt(waveform, routeVoltageBlend(positions, -1)!, 0), 0)
  assert.equal(routeVoltageAt(waveform, routeVoltageBlend(positions, 1e6)!, 4e-9), 7)
})

test('interpolation brackets physical arc length across bends instead of jumping to a nearby return leg', () => {
  const points = [
    { index: 0, position: 0, gap: 0 },
    { index: 1, position: 40, gap: 0 },
    { index: 2, position: 80, gap: 0 },
  ]
  assert.deepEqual(routeVoltageBlend(points, 20), { before: 0, after: 1, fraction: 0.5 })
  assert.deepEqual(routeVoltageBlend(points, 60), { before: 1, after: 2, fraction: 0.5 })
  assert.equal(routeVoltageBlend([], 2), undefined)
})

test('the colour range fits actual probe samples and the first edge is the earliest mid-swing crossing', () => {
  const captures = [
    {
      timestampsSeconds: [0, 1e-9, 2e-9, 3e-9, 4e-9],
      probes: [
        { name: 'quiet', sourcePortId: 'a', voltageLevels: [0.1, 0.1, 0.1, 0.1, 0.1] },
        { name: 'late', sourcePortId: 'b', voltageLevels: [0, 0, 0, 3.3, 3.3] },
        { name: 'early', sourcePortId: 'c', voltageLevels: [-0.2, -0.2, 1.5, 1.5, 1.5] },
      ],
    },
  ]
  assert.deepEqual(routeVoltageRange(captures), { low: -0.2, high: 3.3 })
  assert.equal(routeFirstEdge(captures), 2e-9)
  assert.equal(routeFirstEdge([{ timestampsSeconds: [0, 1], probes: [{ name: 'flat', sourcePortId: 'a', voltageLevels: [1, 1] }] }]), 0)
  assert.deepEqual(routeVoltageRange([]), { low: 0, high: 1 })
})
