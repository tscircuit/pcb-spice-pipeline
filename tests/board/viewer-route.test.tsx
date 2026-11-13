import test from 'node:test'
import assert from 'node:assert/strict'
import { routedCopper } from '../support/routed-fixture'
import { boardRouteSegments, stackupFromCircuitJson } from '../../src/board'

test('physical TSX trace meshes retain real copper width, thickness, layer depth and cumulative distance', async () => {
  const { circuitJson } = await routedCopper()
  const stack = stackupFromCircuitJson(circuitJson)
  const segments = boardRouteSegments(circuitJson, stack)
  assert.ok(segments.length >= 2)
  for (const segment of segments) {
    const layer = stack.copperLayers.find((layer) => layer.name === segment.layer)!
    assert.equal(segment.thickness, layer.zMaxMm - layer.zMinMm)
    assert.equal(segment.width, 0.1)
    assert.equal(segment.end - segment.start, Math.hypot(...segment.b.map((value, axis) => value - segment.a[axis])))
  }
})
