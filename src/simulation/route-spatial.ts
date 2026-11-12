/** One electrical ladder node in the Circuit JSON board coordinate frame (mm). */
export interface RouteSpatialPoint {
  node: string
  net: string
  layer: string
  x: number
  y: number
}

/** Bounded spatial capture; volts[pointIndex][timeIndex] is ground-referenced voltage. */
export interface RouteSpatialWaveform {
  points: RouteSpatialPoint[]
  timeSeconds: number[]
  volts: number[][]
}
