import { z } from 'zod'

const endpoint = z.union([
  z.object({ kind: z.literal('single'), source_port_id: z.string(), ibis_model_name: z.string().optional() }),
  z.object({ kind: z.literal('differential'), p_source_port_id: z.string(), n_source_port_id: z.string(), ibis_model_name: z.string().optional() }),
])
export const simulation_signal_integrity = z.object({
  type: z.literal('simulation_signal_integrity'), simulation_signal_integrity_id: z.string().min(1), name: z.string().optional(),
  bit_rate_bps: z.number().positive().finite(), duration_s: z.number().positive().finite(),
  corner: z.enum(['typ', 'min', 'max']), unlisted_nets: z.literal('passive'),
  unrouted: z.enum(['error', 'ideal']), pdn: z.enum(['extracted', 'ideal']), supply: z.enum(['board', 'ibis']),
})
export const simulation_signal = z.object({
  type: z.literal('simulation_signal'), simulation_signal_id: z.string().min(1), simulation_signal_integrity_id: z.string(),
  name: z.string().min(1), driver: endpoint, receivers: z.array(endpoint).min(1), bit_rate_bps: z.number().positive().finite(),
  pattern: z.string().min(1), seed: z.number().int(), offset_s: z.number().nonnegative().finite(),
  quiet: z.enum(['low', 'high', 'off']).optional(), probe: z.enum(['local', 'global']),
  mask: z.union([z.literal('ibis'), z.object({ vih_v: z.number().finite().optional(), vil_v: z.number().finite().optional(), setup_s: z.number().nonnegative().optional(), hold_s: z.number().nonnegative().optional() })]),
  strobe_simulation_signal_id: z.string().optional(),
})
export type SimulationSignalIntegrity = z.infer<typeof simulation_signal_integrity>
export type SimulationSignal = z.infer<typeof simulation_signal>
export type SignalEndpoint = SimulationSignal['driver']
export interface SignalWaveform {
  [key: string]: unknown
  type: 'simulation_signal_waveform'; simulation_signal_waveform_id: string
  simulation_signal_id: string; end: 'near' | 'far'; source_port_id: string
  reference_source_port_id: string; time_s: number[]; voltage_v: number[]
}
export interface SignalEye {
  [key: string]: unknown
  type: 'simulation_signal_eye'; simulation_signal_eye_id: string; simulation_signal_id: string; source_port_id: string
  unit_interval_s: number; folded_traces: number[][][]; eye_height_v: number; eye_width_s: number
  mask_margin_v: number; vih_v: number; vil_v: number; alignment: 'bit_rate' | 'strobe'
}
export interface SignalCrosstalk {
  [key: string]: unknown
  type: 'simulation_signal_crosstalk'; simulation_signal_crosstalk_id: string; simulation_signal_id: string
  peak_next_v: number; peak_fext_v: number
}
export interface SignalStrobeMargin {
  [key: string]: unknown
  type: 'simulation_signal_strobe_margin'; simulation_signal_strobe_margin_id: string; simulation_signal_id: string; source_port_id: string
  edges: { time_s: number; setup_margin_s: number; hold_margin_s: number }[]
  worst_setup_margin_s: number; worst_hold_margin_s: number
}
export interface SignalIntegrityRlgc {
  [key: string]: unknown
  type: 'simulation_signal_integrity_rlgc'; simulation_signal_integrity_rlgc_id: string; simulation_signal_integrity_id: string
  signal_order: string[]; source_port_order: string[]
  matrices: { frequency_hz: number; r_ohm: number[][]; l_h: number[][]; g_s: number[][]; c_f: number[][] }[]
}
export type SignalResult = SignalWaveform | SignalEye | SignalCrosstalk | SignalStrobeMargin | SignalIntegrityRlgc
