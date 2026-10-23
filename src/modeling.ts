import { z } from 'zod'
import type { CircuitJson } from './schema.js'
import type { PipelineModeling } from './general-pipeline.js'
import { fail } from './matrices.mjs'

const positive = z.number().finite().positive()
const id = z.string().min(1)
const profile = z.object({
  spacing_mm: positive, relative_permittivity: positive,
  return: z.object({ width_mm: positive, thickness_mm: positive, length_factor: positive,
    center_y_mm: z.number().finite(), center_z_mm: z.number().finite() }),
})
const channelSchema = z.object({
  reduction: z.enum(['routed-copper', 'straightened-stages']),
  sections: z.number().int().min(1).max(128),
  lanes: z.array(z.object({ name: id, driver_source_port_id: id, receiver_source_port_id: id })).min(1).max(3),
  reference_source_port_id: id,
  passive_source_component_ids: z.array(id).optional(),
  extraction: z.object({
    minimum_frequency_hz: positive, maximum_frequency_hz: positive, model_frequency_hz: positive,
    filaments: positive.int(), refinement_filaments: positive.int(),
    convergence_tolerance: positive, capacitance_tolerance: positive,
    reciprocity_tolerance: positive, dc_resistance_tolerance: positive,
    max_panel_length_mm: positive, ground_mesh_size_mm: positive.optional(),
  }),
  relative_permittivity: positive.optional(), via_plating_thickness_mm: positive.optional(),
  via_equivalent_width_mm: positive.optional(), omit_through_via_stubs: z.boolean().optional(),
  straightened_stage_profiles: z.record(profile).optional(),
}).superRefine((channel, ctx) => {
  const e = channel.extraction
  const issue = (path: string[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  if (e.minimum_frequency_hz > e.model_frequency_hz || e.model_frequency_hz > e.maximum_frequency_hz)
    issue(['extraction'], 'Require minimum_frequency_hz <= model_frequency_hz <= maximum_frequency_hz')
  if (e.refinement_filaments <= e.filaments)
    issue(['extraction', 'refinement_filaments'], 'Must exceed filaments')
  if (new Set(channel.lanes.map(lane => lane.name)).size !== channel.lanes.length)
    issue(['lanes'], 'Lane names must be distinct')
  if (channel.reduction === 'routed-copper' && e.ground_mesh_size_mm === undefined)
    issue(['extraction', 'ground_mesh_size_mm'], 'Required for routed-copper')
  if (channel.reduction === 'straightened-stages' && !Object.keys(channel.straightened_stage_profiles ?? {}).length)
    issue(['straightened_stage_profiles'], 'Profiles required for straightened-stages')
})

// Ignore object key order, while retaining lane/matrix array order.
const canonical = (value: unknown): string => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** Read raw channel declarations, independently of the installed Circuit JSON schema. */
export function modelingFromCircuitJson(circuitJson: CircuitJson): PipelineModeling {
  if (!Array.isArray(circuitJson)) fail('pcb_spice_channel', 'Expected a Circuit JSON record array')
  const experiments = circuitJson.filter(record => record.type === 'simulation_experiment').filter(record =>
    record.spice_engine === 'pcb_spice' && record.experiment_type === 'spice_transient_analysis')
  if (!experiments.length) fail('pcb_spice_channel', 'No pcb_spice transient pcb_spice_channel found; supply modeling or declare pcbSpiceChannel')
  const channels = experiments.map(record => {
    const raw = Reflect.get(record, 'pcb_spice_channel')
    if (raw === undefined) fail('pcb_spice_channel', `${record.simulation_experiment_id}: missing pcb_spice_channel; supply modeling or declare pcbSpiceChannel`)
    const parsed = channelSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      fail('pcb_spice_channel', `${record.simulation_experiment_id}: pcb_spice_channel.${issue.path.join('.')}: ${issue.message}`)
    }
    return parsed.data
  })
  if (channels.some(channel => canonical(channel) !== canonical(channels[0])))
    fail('pcb_spice_channel', 'All pcb_spice transient experiments must declare deep-equal pcb_spice_channel values for shared extraction')
  const c = channels[0], e = c.extraction
  const modeling: PipelineModeling = {
    reduction: c.reduction, sections: c.sections,
    lanes: c.lanes.map(lane => ({ port: lane.name, from: { sourcePortId: lane.driver_source_port_id }, to: { sourcePortId: lane.receiver_source_port_id } })),
    channelReference: { sourcePortId: c.reference_source_port_id },
    extraction: { minimumHz: e.minimum_frequency_hz, maximumHz: e.maximum_frequency_hz, modelHz: e.model_frequency_hz,
      filaments: e.filaments, refinementFilaments: e.refinement_filaments, convergenceTolerance: e.convergence_tolerance,
      capTolerance: e.capacitance_tolerance, reciprocityTolerance: e.reciprocity_tolerance,
      dcResistanceTolerance: e.dc_resistance_tolerance, maxPanelLengthMm: e.max_panel_length_mm },
  }
  if (e.ground_mesh_size_mm !== undefined) modeling.extraction.groundMeshMm = e.ground_mesh_size_mm
  if (c.passive_source_component_ids !== undefined) modeling.passiveComponents = c.passive_source_component_ids.map(sourceComponentId => ({ sourceComponentId }))
  if (c.relative_permittivity !== undefined) modeling.relativePermittivity = c.relative_permittivity
  if (c.via_plating_thickness_mm !== undefined) modeling.viaPlatingMm = c.via_plating_thickness_mm
  if (c.via_equivalent_width_mm !== undefined) modeling.viaEquivalentWidthMm = c.via_equivalent_width_mm
  if (c.omit_through_via_stubs !== undefined) modeling.omitThroughViaStubs = c.omit_through_via_stubs
  if (c.straightened_stage_profiles !== undefined) modeling.profiles = Object.fromEntries(Object.entries(c.straightened_stage_profiles).map(([name, p]) => [name, {
    spacingMm: p.spacing_mm, relativePermittivity: p.relative_permittivity,
    return: { widthMm: p.return.width_mm, thicknessMm: p.return.thickness_mm, lengthFactor: p.return.length_factor,
      centerYMm: p.return.center_y_mm, centerZMm: p.return.center_z_mm },
  }]))
  for (const record of circuitJson.filter(record => record.type === 'simulation_ibis_model')) {
    const hash = Reflect.get(record.ibis_model_asset, 'sha256')
    if (hash === undefined) continue
    const path = record.ibis_model_asset.project_relative_path
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) fail('vendor_hash', `${path}: ibis_model_asset.sha256 must be a 64-digit SHA-256 hash`)
    const hashes = modeling.ibisModelAssetSha256 ??= {}
    if (hashes[path] && hashes[path] !== hash.toLowerCase()) fail('vendor_hash', `${path}: conflicting ibis_model_asset.sha256 hashes`)
    hashes[path] = hash.toLowerCase()
  }
  return modeling
}
