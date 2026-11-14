export { simulation_signal, simulation_signal_integrity } from 'circuit-json'
export type { SimulationSignal, SimulationSignalIntegrity, SignalEndpoint } from 'circuit-json'
import type { SimulationSignal } from 'circuit-json'

/** Constant literal patterns and disabled drivers record quiet-channel idle voltages. */
export function isQuiet(signal: SimulationSignal): boolean {
  return !!signal.driver_disabled || /^(?:0+|1+)$/.test(signal.pattern)
}
