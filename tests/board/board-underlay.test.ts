import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { boardBounds, boardLayers, boardLayerColor, boardTraceWidth, boardUnderlay, boardUnderlayCopy, type CircuitJson } from '../../src/board'
import { boardCases } from './fixtures'
import { edgeBoard, assertDrawable } from '../support/edge-boards'

const cases: [string, CircuitJson][] = [
  ['1 layer', edgeBoard({ layers: 1 })],
  ['2 layers', edgeBoard()],
  ['6 layers', edgeBoard({ layers: 6 })],
  ['outline board', edgeBoard({ outline: true })],
  ['no pours', edgeBoard({ pours: false })],
  ['no parts', edgeBoard({ parts: false })],
  ['widthless traces', edgeBoard({ widthless: true })],
  ['no board record', edgeBoard().filter((record) => record.type !== 'pcb_board')],
  ['empty', []],
]

for (const [name, circuit] of cases)
  test(`underlay draws ${name} without throwing`, () => {
    if (name === 'empty') {
      assert.deepEqual(boardBounds(circuit), { minX: -1, maxX: 1, minY: -1, maxY: 1 })
      return
    }
    assertDrawable(boardUnderlay(circuit), name)
  })

test('underlay sits in real board mm, including a declared outline', () => {
  const outline = edgeBoard({ outline: true })
  assert.deepEqual(boardBounds(outline), { minX: 0, maxX: 40, minY: 0, maxY: 25 })
  assert.deepEqual(boardBounds(edgeBoard()), { minX: -12, maxX: 18, minY: -12, maxY: 8 })
  const trace = boardUnderlay(edgeBoard()).lines!.find((line) => line.points.length === 2 && line.points[0].x === -5)!
  assert.deepEqual(trace.points, [{ x: -5, y: 0 }, { x: 5, y: 0 }])
  assert.equal(trace.strokeWidth, 0.2)
})

test('layers follow the stackup or layer count; every layer gets a distinct muted colour', () => {
  const six = edgeBoard({ layers: 6 })
  const layers = boardLayers(six)
  assert.equal(layers.length, 6)
  assert.equal(new Set(layers.map((layer) => boardLayerColor(layers, layer))).size, 6)
  const stacked = [...six, { type: 'pcb_stackup', layers: ['a', 'b', 'c'].map((layer) => ({ layer, layer_type: 'copper' })) }] as unknown as CircuitJson
  assert.deepEqual(boardLayers(stacked).slice(0, 3), ['a', 'b', 'c'])
  assert.deepEqual(boardLayers(edgeBoard({ layers: 1 })), ['top'])
})

test('missing trace widths fall back to the board minimum, then a default', () => {
  const circuit = edgeBoard({ widthless: true })
  assert.equal(boardTraceWidth(circuit, undefined), 0.15)
  assert.equal(boardTraceWidth([{ ...circuit[0], min_trace_width: 0.1 }] as CircuitJson, 0), 0.1)
  assert.ok(boardUnderlay(circuit).lines!.some((line) => line.strokeWidth === 0.15))
})

test('cached underlay returns fresh arrays so stage overlays never leak into the cache', () => {
  const circuit = edgeBoard()
  const first = boardUnderlayCopy(circuit)
  first.lines!.push({ points: [] })
  assert.equal(boardUnderlayCopy(circuit).lines!.length, first.lines!.length - 1)
})

test('every board fixture draws a finite underlay', async () => {
  for (const { name, circuit } of await boardCases()) assertDrawable(boardUnderlay(circuit), name)
})

test('a full DDR3 board underlay stays fast', { skip: !process.env.SI_DDR3_BOARD && 'Set SI_DDR3_BOARD to the local full-board Circuit JSON' }, () => {
  const path = process.env.SI_DDR3_BOARD!
  if (!existsSync(path)) return
  const circuit = JSON.parse(readFileSync(path, 'utf8')) as CircuitJson
  const started = performance.now()
  assertDrawable(boardUnderlay(circuit), 'ddr3')
  assert.ok(performance.now() - started < 500, 'underlay under 0.5 s')
})
