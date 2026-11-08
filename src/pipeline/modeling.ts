import { z } from 'zod'
import type { CircuitJson, BoardModeling } from '../board'
import type { SimulationModeling } from '../simulation'
import type { DdrModeling } from '../ddr'
import type { BufferModeling } from '../buffers'
import { fail } from './diagnostics'

export type Modeling = BoardModeling & SimulationModeling & DdrModeling
export type PipelineModeling = Modeling & BufferModeling
const id = z.string().min(1)
const channelSchema = z.object({
  lanes: z.array(z.object({ name: id, driver_source_port_id: id, receiver_source_port_id: id })).min(1),
  passive_source_component_ids: z.array(id).optional(),
}).strict()
/** Derives only electrical endpoints and passives; numerical settings are deliberately absent. */
export function modelingFromCircuitJson(circuitJson: CircuitJson): PipelineModeling {
  const experiments = circuitJson.filter(r => r.type === 'simulation_experiment' && r.spice_engine === 'pcb_spice')
  if (!experiments.length) fail('pcb_spice_channel', 'No pcb_spice experiment; declare channel endpoints or supply modeling.lanes')
  const channels = experiments.map(r => {
    const parsed = channelSchema.safeParse(Reflect.get(r, 'pcb_spice_channel'))
    if (!parsed.success) fail('pcb_spice_channel', `pcb_spice_channel: ${parsed.error.issues[0].message}`)
    return parsed.data
  })
  if (channels.some(c => JSON.stringify(c) !== JSON.stringify(channels[0]))) fail('pcb_spice_channel', 'All experiments must declare the same channel endpoints')
  return { lanes: channels[0].lanes.map(l => ({ port: l.name, from: { sourcePortId: l.driver_source_port_id }, to: { sourcePortId: l.receiver_source_port_id } })),
    ...(channels[0].passive_source_component_ids ? { passiveComponents: channels[0].passive_source_component_ids.map(sourceComponentId => ({ sourceComponentId })) } : {}) }
}
