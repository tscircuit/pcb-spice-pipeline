import test from 'node:test'
import assert from 'node:assert/strict'
import { routedCopper } from '../support/routed-fixture'
import { segmentRoutes, type RouteWire, type RouteXY } from '../../src/board'
import { RouteFieldsSolver } from '../../src/extraction'
import { routeLadder } from '../../src/simulation/route-ladder'

/** Electrical identity follows physical TSX copper endpoints. */
const endpoint = (wire: RouteWire, point: RouteXY): string => `${wire.layer}_${point.map(value => value.toFixed(8)).join('_')}`

test('actual routed TSX exceeds the old 1024-cell cap with locally supported coupling', async () => {
  const { circuitJson, scope } = await routedCopper()
  const fields = new RouteFieldsSolver({ geometry: segmentRoutes(circuitJson, scope), artifactPrefix: 'test' })
  fields.solve()
  const result = routeLadder(fields.getOutput().value, endpoint, 1e-12)
  assert.ok(result.cells > 1024)
  const couplings = result.lines.filter(line => line.startsWith('K'))
  assert.ok(couplings.length > 0)
  assert.ok(couplings.length < result.cells * 30, 'fixed-width local slices scale with cell count')
  assert.ok(result.lines.some(line => line.startsWith('GARCS')), 'actual TSX copper exercises coupled Foster resistance')
  assert.equal(result.lines.filter(line => /^[VH]ARCS/.test(line)).length, 0, 'tiny Foster voltages must not be differences along sensor/CCVS chains')
  assert.ok(result.lines.filter(line => /^RARCS/.test(line)).every(line => line.split(' ')[2] !== '0' || line.endsWith(' 1')), 'coupled resistance equations have unit diagonal')
})
