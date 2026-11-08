import test from 'node:test'
import assert from 'node:assert/strict'
import { geometryFromCircuitJson, type CircuitJson, type BoardModeling } from '../../src/board'
import { circuitJson, modeling } from '../../examples/crosstalk/index.circuit'
import { circuitJson as multilayer } from '../../examples/multilayer/index.circuit'

/** Explicit old numerical controls are confined to the reproduction. */
const oldModel = (): BoardModeling => ({ ...modeling, reduction: 'straightened-stages', sections: 2,
  channelReference: { component: 'TX0', port: 'GND' },
  extraction: { minimumHz: 1, modelHz: 1e8, maximumHz: 1e9, filaments: 3, refinementFilaments: 7,
    convergenceTolerance: .05, capTolerance: .02, reciprocityTolerance: .025, dcResistanceTolerance: .002, maxPanelLengthMm: 1 },
})

test('real TSX reproductions include SC70 pads, three distinct routes and a layer-changing split-pour board', () => {
  assert.equal(circuitJson.filter(r => r.type === 'simulation_ibis_model').length, 6)
  assert.ok(circuitJson.filter(r => r.type === 'pcb_smtpad').length >= 30)
  assert.ok(multilayer.some(r => r.type === 'pcb_via'))
  assert.ok(multilayer.some(r => r.type === 'pcb_copper_pour'))
})

test('BEFORE: lane permutations assign physical neighbours to different matrix entries', () => {
  const m = oldModel()
  const forward = geometryFromCircuitJson(circuitJson as CircuitJson, m)
  const permuted = geometryFromCircuitJson(circuitJson as CircuitJson, { ...m, lanes: [m.lanes[0], m.lanes[2], m.lanes[1]] })
  const distance = (g: typeof forward, a: number, b: number): number => Math.abs(g.cells[0].conductors[a].yM - g.cells[0].conductors[b].yM)
  assert.notEqual(distance(forward, 0, 1), distance(permuted, 0, 2), 'same physical pair changes separation when reordered')
  assert.equal(forward.cells[0].conductors.at(-1)!.widthM, .002, 'invented 2 mm return strip')
})
