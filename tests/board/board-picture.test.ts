import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import type { GraphicsObject } from 'graphics-debug'
import { boardPicture, boardPictureSvg, boardPictureView } from '../../src/board/board-picture'
import { routedVisualFixture } from '../support/routed-visual-fixture'

/** The pixel centre of the first SVG circle whose attributes match. */
function centre(svg: string, pattern: RegExp): [number, number] {
  const element = svg.match(/<circle[^>]*>/g)!.find((circle) => pattern.test(circle))!
  return [Number(/cx="([^"]+)"/.exec(element)![1]), Number(/cy="([^"]+)"/.exec(element)![1])]
}

/** The x, y offset of the nested board svg inside the letterboxed picture. */
function offset(board: string): [number, number] {
  const nested = /<svg x="([^"]+)" y="([^"]+)"/.exec(board)!
  return [Number(nested[1]), Number(nested[2])]
}

/** An overlay pixel position after its root viewBox crop. */
function project(overlay: string, point: [number, number]): [number, number] {
  const [, width, height, box] = /<svg[^>]*width="([^"]+)" height="([^"]+)" viewBox="([^"]+)"/.exec(overlay)!
  const [x, y, w, h] = box.split(' ').map(Number)
  return [((point[0] - x) * Number(width)) / w, ((point[1] - y) * Number(height)) / h]
}

test('the real board and the stage drawing share one camera: a via lands on the same pixel in both layers', async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const via = circuit.find((record) => record.type === 'pcb_via')!
  if (via.type !== 'pcb_via') throw new Error('fixture has a via')
  const stage = root.visualizeStage(1)
  const drawing: GraphicsObject = { ...stage, circles: [{ center: { x: via.x, y: via.y }, radius: 0.05, fill: '#ff0000' }], lines: [...stage.lines!, { points: [{ x: -1e3, y: -1e3 }, { x: 1e3, y: 1e3 }] }] }
  for (const [width, height] of [[800, 600], [1200, 500], [500, 900]]) {
    const picture = boardPicture(circuit, drawing, width, height)
    const [left, top] = offset(picture.board)
    const board = centre(picture.board, /data-type="pcb_via"/)
    const overlay = project(picture.overlay, centre(picture.overlay, /fill="#ff0000"/))
    assert.ok(Math.hypot(board[0] + left - overlay[0], board[1] + top - overlay[1]) < 0.5, `${width}x${height}: ${board} vs ${overlay}; a far-away line never moves the camera`)
  }
})

test('an empty drawing views the whole board; a stage views its frame; silkscreen text never reaches the board layer', async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const board = circuit.find((record) => record.type === 'pcb_board')!
  const whole = boardPictureView(circuit, { coordinateSystem: 'cartesian' })
  assert.ok(whole.minX < board.center.x - board.width! / 2 && whole.maxX > board.center.x + board.width! / 2)
  const frame = root.visualizeStage(1).rects!.find((rect) => rect.label === 'camera')!
  assert.deepEqual(boardPictureView(circuit, root.visualizeStage(4)), boardPictureView(circuit, root.visualizeStage(1)), 'every stage shares one camera')
  assert.equal(boardPictureView(circuit, root.visualizeStage(1)).maxX, frame.center.x + frame.width / 2)
  const labelled = [...circuit, { type: 'pcb_silkscreen_text', pcb_silkscreen_text_id: 't', pcb_component_id: 'c', text: 'REFDES', anchor_position: { x: 0, y: 0 }, font: 'tscircuit2024', font_size: 1, layer: 'top', anchor_alignment: 'center' }] as typeof circuit
  assert.doesNotMatch(boardPicture(labelled, { coordinateSystem: 'cartesian' }, 400, 300).board, /REFDES/)
})

/** RGBA pixels of a PNG, decoded by rendering it as an SVG image. */
function pixels(png: Buffer, width: number, height: number): Uint8Array {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`).render().pixels
}

test('composed board pictures of every two-trace stage match their PNG snapshots', async () => {
  const { root } = await routedVisualFixture()
  const [width, height] = [480, 300]
  for (const number of [0, 1, 2, 3, 4, 5, 6]) {
    const png = new Resvg(boardPictureSvg(root.inputProblem.circuitJson, root.visualizeStage(number), width, height), { font: { defaultFontFamily: 'Arial' } }).render().asPng()
    const path = join(import.meta.dirname, '__snapshots__', `board-picture-stage-${number}.png`)
    if (process.env.UPDATE_ROUTED_VISUALS === '1') {
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, png)
    }
    const [actual, expected] = [pixels(png, width, height), pixels(readFileSync(path), width, height)]
    let differing = 0
    for (let i = 0; i < actual.length; i += 4) if (Math.max(...[0, 1, 2].map((c) => Math.abs(actual[i + c] - expected[i + c]))) > 48) differing++
    // Font rasterisation differs between machines; geometry and colour changes move far more pixels than this.
    assert.ok(differing / (width * height) < 0.01, `stage ${number}: ${differing} pixels differ; inspect the PNG before updating snapshots`)
  }
})
