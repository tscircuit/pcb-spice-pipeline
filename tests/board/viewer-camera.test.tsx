import test from 'node:test'
import assert from 'node:assert/strict'
import { routedCopper } from '../support/routed-fixture'
import { boardCameraShot, boardPathPosition, boardSectionView, boardSectionZ, segmentRoutes, type BoardPosition } from '../../src/board'

test('every scripted stage targets the TSX board bounds; Fields looks along the physical trace axis', async () => {
  const { circuitJson, scope } = await routedCopper()
  const geometry = segmentRoutes(circuitJson, scope)
  const slice = geometry.slices[0]
  for (const stage of [0, 1, 2, 3, 4, 5, 6])
    for (const progress of [0, 0.5, 1]) {
      const shot = boardCameraShot(circuitJson, geometry.stack, {
        stage,
        progress,
        slice,
        focus: [
          [-4, 0, 0.7],
          [4, 0.35, 0.7],
        ],
      })
      assert.ok(Math.abs(shot.target[0]) <= 6 && Math.abs(shot.target[1]) <= 4)
      assert.ok(shot.position.every(Number.isFinite))
      assert.ok(Math.hypot(...shot.position.map((value, i) => value - shot.target[i])) > 0.1)
      if (stage === 3) {
        const direction = shot.target.map((value, i) => value - shot.position[i]) as BoardPosition
        assert.ok(Math.abs(direction[2]) < 1e-12)
        assert.ok(Math.abs(direction[0] * slice.wires[0].u[1] - direction[1] * slice.wires[0].u[0]) < 1e-12)
        assert.ok(direction[0] * slice.wires[0].u[0] + direction[1] * slice.wires[0].u[1] > 0)
        // The true-scale cross-section of copper and its nearest plane fills the frame, not the whole board.
        assert.ok(Math.hypot(...direction) < 1, `${Math.hypot(...direction)}`)
      }
    }
})

test('camera tracking follows physical bends and vertical segments rather than a straight chord', () => {
  const points: BoardPosition[] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 4, 0],
    [4, 4, 2],
  ]
  assert.deepEqual(boardPathPosition(points, 0.5), [4, 1, 0])
  assert.deepEqual(boardPathPosition(points, 0.9), [4, 4, 1])
  assert.deepEqual(boardPathPosition(points, -1), points[0])
  assert.deepEqual(boardPathPosition(points, 2), points.at(-1))
})

test('Fields framing keeps traces a useful share of the width with a monotonic, labelled z mapping', async () => {
  const { circuitJson, scope } = await routedCopper()
  const geometry = segmentRoutes(circuitJson, scope)
  for (const slice of geometry.slices) {
    const view = boardSectionView(geometry.stack, slice)
    const first = slice.wires[0].transverse
    const edges = slice.wires.flatMap(wire => [wire.transverse - first - wire.width / 2, wire.transverse - first + wire.width / 2])
    assert.ok(view.left < Math.min(...edges) && view.right > Math.max(...edges))
    assert.ok((Math.max(...edges) - Math.min(...edges)) / (view.right - view.left) >= 0.2)
    assert.ok(Number.isInteger(view.exaggeration) && view.exaggeration >= 1)
    assert.ok(view.gap.scale > 0 && view.gap.scale <= 1)
    assert.equal(boardSectionZ(view, view.pivot), view.pivot)
    const samples = [view.bottom, view.gap.from, (view.gap.from + view.gap.to) / 2, view.gap.to, view.pivot, view.top]
      .sort((a, b) => a - b)
      .map(z => boardSectionZ(view, z))
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1])
    // The displayed window is never taller than about half the visible width.
    assert.ok(boardSectionZ(view, view.top) - boardSectionZ(view, view.bottom) <= (0.5 * (view.right - view.left)) / 2.4 + 1e-9)
  }
})
