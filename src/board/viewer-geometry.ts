import type { BoardStackup } from './stackup'
import type { RouteSlice } from './route-sections'

/** Three.js viewer coordinates in board millimetres: x/y unchanged, z up. */
export type BoardPosition = [number, number, number]
export interface BoardFrame {
  bottom: number
  top: number
  center: number
}
export interface SlicePose {
  origin: BoardPosition
  transverse: BoardPosition
  vertical: BoardPosition
  normal: BoardPosition
}

/** Centre the physical stack about the viewer's board midplane, without scaling thickness. */
export function boardFrame(stack: BoardStackup): BoardFrame {
  const bottom = Math.min(...stack.copperLayers.map(layer => layer.zMinMm))
  const top = Math.max(...stack.copperLayers.map(layer => layer.zMaxMm))
  if (!Number.isFinite(bottom) || !Number.isFinite(top) || top <= bottom) throw new Error('Missing physical copper stack')
  return { bottom, top, center: (bottom + top) / 2 }
}

/** Keep PCB x/y absolute (including off-centre boards); put copper at its stackup centre. */
export function boardPosition(stack: BoardStackup, x: number, y: number, layer: string): BoardPosition {
  const copper = stack.copperLayers.find(entry => entry.name === layer)
  if (!copper) throw new Error(`Unknown copper layer ${layer}`)
  return [x, y, (copper.zMinMm + copper.zMaxMm) / 2 - boardFrame(stack).center]
}

/** Embed the solver's transverse-x/stack-z section normal to the real route direction. */
export function boardSlicePose(stack: BoardStackup, slice: RouteSlice, fraction: number = .5): SlicePose {
  const wire = slice.wires[0]
  if (!wire) throw new Error('Slice has no routed wire')
  const along = slice.start + (slice.end - slice.start) * Math.max(0, Math.min(1, fraction))
  const [x, y] = wire.u
  return {
    origin: [x * along - y * wire.transverse, y * along + x * wire.transverse, -boardFrame(stack).center],
    transverse: [-y, x, 0],
    vertical: [0, 0, 1],
    normal: [x, y, 0],
  }
}

/** Cross-section x is relative to the first conductor; z retains the solver's stack origin. */
export function boardSlicePosition(pose: SlicePose, x: number, z: number): BoardPosition {
  return pose.origin.map((value, i) => value + x * pose.transverse[i] + z * pose.vertical[i]) as BoardPosition
}
