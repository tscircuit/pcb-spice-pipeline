import test from 'node:test'
import assert from 'node:assert/strict'
import { routeBoardDrawing, routeBoardPoint } from '../../src/board'
import { routedCopper } from '../support/routed-fixture'

test('board atlas fits physical mm and keeps y upward; selected routes retain their colour', async () => {
  const { circuitJson, scope } = await routedCopper()
  const origin = routeBoardPoint(circuitJson, [0, 0])
  assert.equal(origin.x, 50)
  assert.ok(routeBoardPoint(circuitJson, [0, 1]).y > origin.y)
  const drawing = routeBoardDrawing(circuitJson, scope, 'Admission')
  assert.ok(drawing.lines!.some(line => line.strokeColor === '#2563eb'))
  assert.ok(drawing.lines!.every(line => line.points.every(point => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100)))
})
