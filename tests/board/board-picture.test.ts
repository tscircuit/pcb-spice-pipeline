import test from 'node:test'
import assert from 'node:assert/strict'
import type { GraphicsObject } from 'graphics-debug'
import { boardPicture, boardPictureSvg, boardPictureView } from '../../src/board/board-picture'
import { routedVisualFixture } from '../support/routed-visual-fixture'

/** The pixel centre of the first SVG circle whose attributes match. */
function centre(svg: string, pattern: RegExp): [number, number] {
  const element = svg.match(/<circle[^>]*>/g)!.find((circle) => pattern.test(circle))!
  return [Number(/cx="([^"]+)"/.exec(element)![1]), Number(/cy="([^"]+)"/.exec(element)![1])]
}

test('the real board and the stage drawing share one camera: a via lands on the same pixel in both layers', async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const via = circuit.find((record) => record.type === 'pcb_via')!
  if (via.type !== 'pcb_via') throw new Error('fixture has a via')
  const drawing: GraphicsObject = { ...root.visualizeStage(1), circles: [{ center: { x: via.x, y: via.y }, radius: 0.05, fill: '#ff0000' }] }
  for (const [width, height] of [[800, 600], [1200, 500], [500, 900]]) {
    const picture = boardPicture(circuit, drawing, width, height)
    const board = centre(picture.board, /data-type="pcb_via"/)
    const overlay = centre(picture.overlay, /fill="#ff0000"/)
    assert.ok(Math.hypot(board[0] - overlay[0], board[1] - overlay[1]) < 0.01, `${width}x${height}: ${board} vs ${overlay}`)
  }
  assert.match(boardPictureSvg(circuit, drawing, 400, 300), /^<svg[^>]*>.*data-type="pcb_via".*fill="#ff0000"/s)
})

test('an empty drawing views the whole board; a drawing views only its own bounds', async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const board = circuit.find((record) => record.type === 'pcb_board')!
  const whole = boardPictureView(circuit, { coordinateSystem: 'cartesian' })
  assert.ok(whole.minX < board.center.x - board.width! / 2 && whole.maxX > board.center.x + board.width! / 2)
  const near = boardPictureView(circuit, root.visualizeStage(1))
  assert.ok(near.maxX - near.minX < whole.maxX - whole.minX, 'the camera closes in on the selected copper')
})
