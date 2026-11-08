import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, type CircuitJson } from '../../../src/board'
import { circuitJson, modeling } from '../../../examples/crosstalk/index.circuit'
import { circuitJson as via, modeling as viaModeling } from '../../../examples/multilayer/index.circuit'

test('segments preserve physical lengths and actual unequal neighbour positions', () => {
  const g = geometryFromCircuitJson(circuitJson as CircuitJson, modeling)
  for (const lane of g.mappings) {
    const segmented = g.cells.reduce((s, c) => s + (c.ports.some(p => p.lane === lane.port) ? c.lengthM * 1000 : 0), 0)
    assert.ok(Math.abs(segmented - lane.stages.reduce((s, v) => s + v.lengthMm, 0)) < 1e-6)
  }
  assert.ok(g.cells.some(c => c.ports.length === 3))
  assert.deepEqual(g, geometryFromCircuitJson(circuitJson as CircuitJson, { ...modeling, lanes: [...modeling.lanes].reverse() }))
})
test('removed numerical settings fail instead of being silently ignored', () => {
  assert.throws(() => geometryFromCircuitJson(circuitJson as CircuitJson, { ...modeling, sections: 1 } as never), { code: 'modeling_input' })
})
test('a via without a recorded antipad raises via_antipad, without guessing', () => {
  assert.throws(() => geometryFromCircuitJson(via as CircuitJson, viaModeling), { code: 'via_antipad' })
})
