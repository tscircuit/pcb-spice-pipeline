/** Strictly increasing finite times (s), equal-length finite volts (V). */
export interface Signal { readonly t: Float64Array; readonly v: Float64Array }
/**
 * Recorded solver rows as probeWaveformRows returns them: [time_s, probe1_v, probe2_v, ...].
 * Column k (1-based) is the k-th declared probe; timestamps are the actual adaptive solver times.
 */
export type WaveformRows = readonly (readonly number[])[]
