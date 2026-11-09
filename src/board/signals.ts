export { simulation_signal, simulation_signal_integrity } from 'circuit-json'
export type { SimulationSignal, SimulationSignalIntegrity, SignalEndpoint } from 'circuit-json'
import type {
  SimulationSignalWaveform, SimulationSignalEye, SimulationSignalCrosstalk,
  SimulationSignalStrobeMargin, SimulationSignalIntegrityRlgc,
} from 'circuit-json'
export type SignalResult = SimulationSignalWaveform | SimulationSignalEye | SimulationSignalCrosstalk | SimulationSignalStrobeMargin | SimulationSignalIntegrityRlgc
