/**
 * observation — turning sampled voltages into eyes and metrics.
 * Owns: Signal (time/voltage arrays), recorded WaveformRows parsing, EyeRequest (declared eye),
 * alignment policy (stimulus clock vs supplied capture times), complete-window folding with linear
 * interpolation of adaptive solver timestamps, eye metrics, eye artifacts.
 * Leaf domain: imports kernel only. simulation and ddr import its types.
 * Artifacts: <experiment>/eyes/<eyeId>/{eye-data.csv, eye-data.json}, <experiment>/eyes.json.
 * (Was: metrics.mjs probeWaveformRows/foldProbeEye + the eye loop of general-pipeline.ts.)
 */
export type { Signal, WaveformRows } from './types'
export { probeWaveformRows } from './waveform'
export { sampleVoltage, crossingTimes, quietPeak, measureEye, strobeMargins } from './measure'

export type { Capture } from './measure'
export { waveformConvergence } from './convergence'
