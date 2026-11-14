import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson } from '../../src/board'
import { groundPlaneFixture } from '../fixtures/ground-plane'

test('only the copper-derived geometry path remains', () => {
  const { circuit, modeling } = groundPlaneFixture()
  assert.ok(geometryFromCircuitJson(circuit, modeling).cells[0].routedCopper)
  assert.throws(() => geometryFromCircuitJson(circuit, { ...modeling, reduction: 'straightened-stages' as never }), /Only routed copper/)
})
