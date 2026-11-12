import type { BaseSolver } from '@tscircuit/solver-utils'

/** Minimal solver-utils compatibility: all explanatory rendering belongs to the physical 3D scene. */
export function emptyVisualization(): ReturnType<BaseSolver['visualize']> {
  return { coordinateSystem: 'cartesian' }
}
