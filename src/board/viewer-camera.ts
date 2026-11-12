import type { CircuitJson } from './schema'
import type { BoardStackup } from './stackup'
import type { RouteSlice } from './route-sections'
import { boardFrame, boardSlicePose, boardSlicePosition, type BoardPosition } from './viewer-geometry'

export interface BoardCameraShot {
  position: BoardPosition
  target: BoardPosition
  up: BoardPosition
}
export interface BoardCameraInput {
  stage: number
  progress?: number
  slice?: RouteSlice
  focus?: BoardPosition[]
  aspect?: number
}

/** Interpolate an ordered physical route by arc length, retaining bends and layer transitions. */
export function boardPathPosition(points: BoardPosition[], fraction: number): BoardPosition {
  if (!points.length) throw new Error('Camera path has no points')
  const lengths = points.slice(1).map((point, i) => Math.hypot(...point.map((value, axis) => value - points[i][axis])))
  let remaining = lengths.reduce((sum, value) => sum + value, 0) * Math.max(0, Math.min(1, fraction))
  for (const [i, length] of lengths.entries()) {
    if (remaining <= length)
      return points[i].map((value, axis) => value + ((points[i + 1][axis] - value) * remaining) / Math.max(length, 1e-12)) as BoardPosition
    remaining -= length
  }
  return [...points.at(-1)!]
}

/** Compute deterministic z-up shots from physical geometry; every target stays within the board bounds. */
export function boardCameraShot(circuit: CircuitJson, stack: BoardStackup, input: BoardCameraInput): BoardCameraShot {
  const board = circuit.find((record) => record.type === 'pcb_board')
  if (!board || board.type !== 'pcb_board') throw new Error('Camera requires a physical board')
  const outline = board.outline?.length
    ? board.outline
    : [
        { x: board.center.x - (board.width ?? 20) / 2, y: board.center.y - (board.height ?? 20) / 2 },
        { x: board.center.x + (board.width ?? 20) / 2, y: board.center.y + (board.height ?? 20) / 2 },
      ]
  const low = [Math.min(...outline.map((point) => point.x)), Math.min(...outline.map((point) => point.y))]
  const high = [Math.max(...outline.map((point) => point.x)), Math.max(...outline.map((point) => point.y))]
  const width = high[0] - low[0]
  const height = high[1] - low[1]
  const extent = Math.max(width, height)
  const frame = boardFrame(stack)
  const progress = Math.max(0, Math.min(1, input.progress ?? 1))
  const focus = input.focus?.length ? input.focus : [[board.center.x, board.center.y, 0] as BoardPosition]
  let target: BoardPosition = [board.center.x, board.center.y, 0]
  let span = Math.max(height * 0.8, width / Math.max(1, input.aspect ?? 2.4))
  let direction: BoardPosition = [0.12, -0.72, 0.68]
  if (input.stage === 1 || input.stage === 6) {
    const center = [0, 1, 2].map(
      (axis) => (Math.min(...focus.map((point) => point[axis])) + Math.max(...focus.map((point) => point[axis]))) / 2,
    ) as BoardPosition
    target = target.map((value, axis) => value + (center[axis] - value) * (input.stage === 1 ? progress : 1)) as BoardPosition
    const selectedSpan = Math.max(
      2,
      (Math.max(...focus.map((point) => point[0])) - Math.min(...focus.map((point) => point[0]))) / Math.max(1, input.aspect ?? 2.4),
      Math.max(...focus.map((point) => point[1])) - Math.min(...focus.map((point) => point[1])),
    )
    span += (selectedSpan - span) * (input.stage === 1 ? progress : 1)
  }
  if (input.stage === 2 || input.stage === 5) {
    target = boardPathPosition(focus, progress)
    span = Math.max(2, extent * (input.stage === 2 ? 0.12 : 0.15))
  }
  if (input.stage === 4) {
    target = [...focus[progress < 0.5 ? 0 : focus.length - 1]]
    span = Math.max(1.4, extent * 0.065)
  }
  if (input.stage === 3 && input.slice) {
    const pose = boardSlicePose(stack, input.slice)
    const first = input.slice.wires[0].transverse
    const left = Math.min(...input.slice.wires.map((wire) => wire.transverse - first - wire.width / 2))
    const right = Math.max(...input.slice.wires.map((wire) => wire.transverse - first + wire.width / 2))
    target = boardSlicePosition(pose, (left + right) / 2, frame.center)
    direction = pose.normal.map((value) => -value) as BoardPosition
    span = Math.max(frame.top - frame.bottom + 0.8, (right - left + 0.8) / Math.max(1, input.aspect ?? 2.4))
  }
  target = [
    Math.max(low[0], Math.min(high[0], target[0])),
    Math.max(low[1], Math.min(high[1], target[1])),
    Math.max(frame.bottom - frame.center, Math.min(frame.top - frame.center, target[2])),
  ]
  const distance = Math.max(0.8, span * (input.stage === 3 ? 0.78 : 1.55))
  const length = Math.hypot(...direction)
  return { target, position: target.map((value, axis) => value + (direction[axis] / length) * distance) as BoardPosition, up: [0, 0, 1] }
}
