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

export interface BoardSectionView {
  /** Transverse window relative to the slice's first wire, mm. */
  left: number
  right: number
  /** Stack z window, mm. */
  bottom: number
  top: number
  /** Stack z that stays fixed on screen (the signal copper). */
  pivot: number
  /** Integer vertical exaggeration; 1 when true scale already shows every layer. */
  exaggeration: number
  /** Bulk dielectric between copper and reference drawn compressed (with a break mark); empty when to scale. */
  gap: { from: number; to: number; scale: number }
}

/** Frame signal copper and its nearest reference plane so traces fill a useful share of the width. */
export function boardSectionView(stack: BoardStackup, slice: RouteSlice, aspect: number = 2.4): BoardSectionView {
  const first = slice.wires[0].transverse
  const layers = slice.wires.map((wire) => stack.copperLayers.find((layer) => layer.name === wire.layer)!)
  const low = Math.min(...layers.map((layer) => layer.zMinMm))
  const high = Math.max(...layers.map((layer) => layer.zMaxMm))
  const pivot = (low + high) / 2
  const index = stack.copperLayers.indexOf(layers[0])
  const planes = slice.references.length
    ? slice.references.map((reference) => reference.z)
    : [stack.copperLayers[index - 1], stack.copperLayers[index + 1]].flatMap((layer) => (layer ? [(layer.zMinMm + layer.zMaxMm) / 2] : []))
  const reference = [...planes].sort((a, b) => Math.abs(a - pivot) - Math.abs(b - pivot))[0] ?? pivot
  const below = reference < pivot
  const gap = Math.max(below ? low - reference : reference - high, 0)
  const edges = slice.wires.flatMap((wire) => [wire.transverse - first - wire.width / 2, wire.transverse - first + wire.width / 2])
  const extent = Math.max(...edges) - Math.min(...edges)
  const margin = Math.max(extent * 0.35, 0.15, Math.min(gap, 0.4))
  const pad = 0.04
  const bottom = Math.min(reference, low) - pad
  const top = Math.max(reference, high) + pad
  const wanted = (0.45 * (extent + 2 * margin)) / Math.max(1, aspect)
  const height = top - bottom
  // Keep a short true-scale stretch of dielectric next to the copper and next to the plane.
  const keep = Math.min(gap * 0.15, wanted * 0.2)
  const from = (below ? reference : high) + keep
  const to = (below ? low : reference) - keep
  // Thick cores compress only between copper and plane; thin stacks are exaggerated uniformly instead.
  const scale = height > wanted && to > from ? Math.max(0.005, 1 - (height - wanted) / (to - from)) : 1
  const exaggeration = scale < 1 ? 1 : Math.max(1, Math.min(20, Math.floor(wanted / height)))
  return {
    left: Math.min(...edges) - margin,
    right: Math.max(...edges) + margin,
    bottom,
    top,
    pivot,
    exaggeration,
    gap: scale < 1 ? { from, to, scale } : { from: pivot, to: pivot, scale: 1 },
  }
}

/** Map stack z to displayed z: monotonic, fixed at the pivot, compressed in the gap and exaggerated elsewhere. */
export function boardSectionZ(view: BoardSectionView, z: number): number {
  /** Length of [pivot, value] after compressing its overlap with the gap. */
  const scaled = (value: number): number => {
    const a = Math.min(view.pivot, value)
    const b = Math.max(view.pivot, value)
    const overlap = Math.max(0, Math.min(b, view.gap.to) - Math.max(a, view.gap.from))
    return Math.sign(value - view.pivot) * (b - a - overlap * (1 - view.gap.scale))
  }
  return view.pivot + scaled(z) * view.exaggeration
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
  // Admission keeps the overview (the UI pulses the selected nets); Transient frames all selected copper.
  if (input.stage === 6) {
    target = [0, 1, 2].map(
      (axis) => (Math.min(...focus.map((point) => point[axis])) + Math.max(...focus.map((point) => point[axis]))) / 2,
    ) as BoardPosition
    span = Math.max(
      2,
      (Math.max(...focus.map((point) => point[0])) - Math.min(...focus.map((point) => point[0]))) / Math.max(1, input.aspect ?? 2.4),
      Math.max(...focus.map((point) => point[1])) - Math.min(...focus.map((point) => point[1])),
    )
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
    const view = boardSectionView(stack, input.slice, input.aspect)
    const bottom = boardSectionZ(view, view.bottom)
    const height = boardSectionZ(view, view.top) - bottom
    // Leave room above the section for the per-conductor callouts.
    target = boardSlicePosition(pose, (view.left + view.right) / 2, bottom + height * 0.8)
    direction = pose.normal.map((value) => -value) as BoardPosition
    span = Math.max(height * 2.1, ((view.right - view.left) * 1.05) / Math.max(1, input.aspect ?? 2.4))
  }
  target = [
    Math.max(low[0], Math.min(high[0], target[0])),
    Math.max(low[1], Math.min(high[1], target[1])),
    // The Fields section is drawn exaggerated in its own plane, so its height may exceed the board thickness.
    input.stage === 3 ? target[2] : Math.max(frame.bottom - frame.center, Math.min(frame.top - frame.center, target[2])),
  ]
  const distance = input.stage === 3 && input.slice ? span * 0.66 : Math.max(0.8, span * 1.55)
  const length = Math.hypot(...direction)
  return { target, position: target.map((value, axis) => value + (direction[axis] / length) * distance) as BoardPosition, up: [0, 0, 1] }
}
