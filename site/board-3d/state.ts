import type { RoutedPipelineSolver } from '../../src/pipeline'
import type { RoutedSections, CopperScope } from '../../src/board'
import type { ExtractedRoutes } from '../../src/extraction'
import type { RoutedBindings, RoutedCapture, RoutedDeck } from '../../src/simulation'

/** Pending upstream contract: native samples only; no waveform is fabricated in the UI. */
export interface RouteSpatialPoint { node: string; net: string; layer: string; x: number; y: number }
export interface RouteSpatialWaveform { points: RouteSpatialPoint[]; timeSeconds: number[]; volts: number[][] }
export interface BoardStageState {
  scopes: CopperScope[]
  sections: RoutedSections[]
  fields: ExtractedRoutes[]
  bindings: RoutedBindings[]
  networks: RoutedDeck[]
  captures: (RoutedCapture & { spatial?: RouteSpatialWaveform })[]
}

/** Read completed immutable outputs only, gated by the same selected Step as the atlas. */
export function boardStageState(root: RoutedPipelineSolver, step: number): BoardStageState {
  /** A completed stage always owns its output; pending stages expose none. */
  const read = <K extends Parameters<RoutedPipelineSolver['stageOutput']>[0]>(name: K): ReturnType<RoutedPipelineSolver['stageOutput']>['value'] =>
    root.getSolver(name)?.solved ? root.stageOutput(name).value : []
  const plans = step >= 1 ? read('RoutedAdmissionSolver') as ReturnType<RoutedPipelineSolver['stageOutput']>['value'] : []
  return {
    scopes: (plans as { sections: { scope: CopperScope } }[]).map(plan => plan.sections.scope),
    sections: step >= 2 ? read('RouteSectionsSolver') as RoutedSections[] : [],
    fields: step >= 3 ? read('RouteFieldsSolver') as ExtractedRoutes[] : [],
    bindings: step >= 4 ? read('RouteBindingsSolver') as RoutedBindings[] : [],
    networks: step >= 5 ? read('RouteNetworkSolver') as RoutedDeck[] : [],
    captures: step >= 6 ? read('RouteTransientSolver') as BoardStageState['captures'] : [],
  }
}

/** Interpolate only in time between actual saved native samples. */
export function spatialVoltage(waveform: RouteSpatialWaveform, point: number, time: number): number | undefined {
  const values = waveform.volts[point]
  const times = waveform.timeSeconds
  if (!values?.length || values.length !== times.length) return undefined
  if (time <= times[0]) return values[0]
  const after = times.findIndex(value => value >= time)
  if (after < 0) return values.at(-1)
  const before = after - 1
  const fraction = (time - times[before]) / (times[after] - times[before])
  return values[before] + (values[after] - values[before]) * fraction
}

/** Fixed volts legend makes colours comparable between nets and times. */
export function voltageColor(voltage: number): string {
  const fraction = Math.min(1, Math.max(0, (voltage + 1) / 6))
  return `hsl(${240 * (1 - fraction)}, 90%, 50%)`
}
