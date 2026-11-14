// Circuit JSON record admission (was schema.ts + circuit-schema.mjs). Validation never edits input.
import { z } from 'zod'
import * as base from 'circuit-json'
import type { CircuitJson as BaseCircuitJson } from 'circuit-json'
import { isQuiet, simulation_signal, simulation_signal_integrity } from './signals'
export type { SimulationIbisModel } from 'circuit-json'
export type CircuitJson = (BaseCircuitJson[number] | SimulationIbisPinState | SimulationDigitalStimulus)[]
import { fail } from './diagnostics'

export type { SimulationExperiment } from 'circuit-json'
/** Private declarations produced only after the public Circuit JSON boundary has been validated. */
export interface SimulationIbisPinState {
  type: 'simulation_ibis_pin_state'; simulation_ibis_pin_state_id: string; simulation_experiment_id: string
  source_port_id: string; is_output: boolean; is_output_enabled?: boolean
}
export interface SimulationDigitalStimulus {
  type: 'simulation_digital_stimulus'; simulation_digital_stimulus_id: string; simulation_experiment_id: string
  name: string; source_port_id: string; bit_duration_ms: number; start_time_ms: number; initial_state: 0 | 1; inverted?: boolean
  transmission_pattern: { transmission_type: 'bits'; bits: string; repeat: boolean }
}

/** Saved boards retain a few older physical serialization forms. Validate their
 * equivalent official schemas without changing the original geometry values. */
const compatible = (schema: z.ZodTypeAny, normalize: (record: Record<string, unknown>) => Record<string, unknown>): z.ZodTypeAny =>
  z.preprocess(value => {
    let normalized = value
    if (value && typeof value === 'object') normalized = normalize({...value})
    return [value, normalized]
  }, z.tuple([z.unknown(), schema])).transform(([original]) => original)

/** Rewrites numeric display offsets to the `<n>mm` strings circuit-json expects (on the validation copy only). */
const numericDisplayOffsets = (record: Record<string, unknown>): Record<string, unknown> => {
  for (const key of ['display_offset_x','display_offset_y']) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) record[key] = `${value}mm`
  }
  return record
}

const physicalCompatibility: Record<string, z.ZodTypeAny> = {
  source_port: compatible(base.source_port, record => {
    if (record.source_component_id === null) delete record.source_component_id
    return record
  }),
  pcb_component: compatible(base.pcb_component, numericDisplayOffsets),
  // Core wrote anchor_alignment: null and numeric display offsets on groups.
  pcb_group: compatible(base.pcb_group, record => {
    if (record.anchor_alignment === null) delete record.anchor_alignment
    return numericDisplayOffsets(record)
  }),
  // Board- and group-level text: circuit-json omits the owner; older core wrote null.
  pcb_silkscreen_text: compatible(base.pcb_silkscreen_text, record => {
    if (record.pcb_component_id === null) delete record.pcb_component_id
    return record
  }),
  pcb_hole: z.union([base.pcb_hole,z.object({type:z.literal('pcb_hole'),pcb_hole_id:z.string().min(1),
    pcb_component_id:z.null(),hole_shape:z.literal('circle'),hole_diameter:z.number().finite().positive(),
    x:z.number().finite(),y:z.number().finite(),subcircuit_id:z.string().min(1).optional(),is_covered_with_solder_mask:z.boolean().optional()}).passthrough()]),
  pcb_plated_hole: compatible(base.pcb_plated_hole, record => {
    if (record.shape === 'circular_hole_with_rect_pad') return {...record,hole_shape:record.hole_shape??'circle',pad_shape:record.pad_shape??'rect'}
    return record
  }),
}
/** Picks the zod schema for one record by its type (source components by ftype), preferring the compatibility schemas. */
export function recordSchema(record: { type: string; ftype?: string }): z.ZodTypeAny | undefined {
  if (record.type === 'simulation_signal') return simulation_signal
  if (record.type === 'simulation_signal_integrity') return simulation_signal_integrity
  let schemaName = record.type
  if (record.type === 'source_component') schemaName = `source_${record.ftype}`
  return physicalCompatibility[record.type] ?? Reflect.get(base, schemaName)
}
/** Select the registered record schema directly, avoiding a union diagnostic
 * containing hundreds of unrelated alternatives. Validation never edits input. */
export function validateCircuitRecords(records: unknown): void {
  if(!Array.isArray(records)) fail('circuit_schema','Expected a Circuit JSON record array')
  for(const record of records as Array<Record<string, unknown> | null | undefined>) {
    const type=record?.type
    const id=record?.[`${type}_id`]??record?.name??'(unnamed)'
    const schema: Partial<z.ZodTypeAny> | undefined=typeof type==='string'?recordSchema(record as { type: string; ftype?: string }):undefined
    if(!schema?.safeParse) fail('circuit_schema',`${type??'(missing type)'} ${id}: no registered record schema`)
    const parsed=schema.safeParse(record)
    if(!parsed.success) {
      const issue=parsed.error.issues[0]
      const path=issue.path?.join('.')
      fail('circuit_schema',`${type} ${id}: ${path?path+': ':''}${issue.message}`)
    }
  }
  const circuit = records as CircuitJson
  const signals = new Map(circuit.filter(record => record.type === 'simulation_signal').map(signal => [signal.simulation_signal_id, signal]))
  for (const waveform of circuit.filter(record => record.type === 'simulation_signal_waveform')) {
    const signal = signals.get(waveform.simulation_signal_id)
    if (signal && isQuiet(signal) !== (waveform.idle_voltage_v !== undefined)) fail('circuit_schema', `${signal.name}: idle_voltage_v is required on quiet waveforms and absent on switching waveforms`)
  }
  for (const rlgc of circuit.filter(record => record.type === 'simulation_signal_integrity_rlgc')) for (const signalId of new Set(rlgc.conductors.map(conductor => conductor.simulation_signal_id))) {
    const signal = signals.get(signalId)
    if (!signal) continue
    const ports = rlgc.conductors.filter(conductor => conductor.simulation_signal_id === signalId).map(conductor => conductor.source_port_id)
    const driver = signal.driver
    const expected = 'source_port_id' in driver ? [driver.source_port_id] : [driver.p_source_port_id, driver.n_source_port_id]
    if (ports.length !== expected.length || expected.some(port => !ports.includes(port))) fail('circuit_schema', `${signal.name}: RLGC conductors must identify every driver port exactly once`)
  }
}
