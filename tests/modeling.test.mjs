import test from 'node:test'
import assert from 'node:assert/strict'
import { modelingFromCircuitJson, runPipeline } from '../src/index.js'
import { validateCircuitRecords } from '../src/circuit-schema.mjs'
import { sha256 } from '../src/hash.js'
import { inMemoryInput, fixtureSolver } from './fixtures/in-memory.mjs'

const extraction = {
  minimum_frequency_hz: 1, maximum_frequency_hz: 1e9, model_frequency_hz: 1e8,
  filaments: 7, refinement_filaments: 11, convergence_tolerance: .05,
  capacitance_tolerance: .02, reciprocity_tolerance: .025, dc_resistance_tolerance: .002,
  max_panel_length_mm: 2,
}
const expectedExtraction = {
  minimumHz: 1, maximumHz: 1e9, modelHz: 1e8, filaments: 7, refinementFilaments: 11,
  convergenceTolerance: .05, capTolerance: .02, reciprocityTolerance: .025,
  dcResistanceTolerance: .002, maxPanelLengthMm: 2,
}
const channel = () => ({
  reduction: 'routed-copper', sections: 12,
  lanes: [{ name: 'DQS', driver_source_port_id: 'p0', receiver_source_port_id: 'p2' },
    { name: 'DQSn', driver_source_port_id: 'p1', receiver_source_port_id: 'p3' }],
  reference_source_port_id: 'g0', extraction: { ...extraction, ground_mesh_size_mm: .5 },
  relative_permittivity: 4.1, via_plating_thickness_mm: .02,
  via_equivalent_width_mm: .3, omit_through_via_stubs: true,
})
const experiment = (c = channel(), id = 'run') => ({
  type: 'simulation_experiment', simulation_experiment_id: id,
  experiment_type: 'spice_transient_analysis', spice_engine: 'pcb_spice',
  name: id, end_time_ms: .01, time_per_step: .000001, pcb_spice_channel: c,
})
const expectedBase = {
  reduction: 'routed-copper', sections: 12,
  lanes: [{ port: 'DQS', from: { sourcePortId: 'p0' }, to: { sourcePortId: 'p2' } },
    { port: 'DQSn', from: { sourcePortId: 'p1' }, to: { sourcePortId: 'p3' } }],
  channelReference: { sourcePortId: 'g0' }, extraction: { ...expectedExtraction, groundMeshMm: .5 },
  relativePermittivity: 4.1, viaPlatingMm: .02, viaEquivalentWidthMm: .3, omitThroughViaStubs: true,
}
const straightChannel = () => ({
  reduction: 'straightened-stages', sections: 12, lanes: channel().lanes,
  reference_source_port_id: 'g0', extraction: { ...extraction },
  passive_source_component_ids: ['rterm'],
  straightened_stage_profiles: { top: { spacing_mm: .75, relative_permittivity: 2.55,
    return: { width_mm: 2, thickness_mm: .035, length_factor: 1, center_y_mm: 0, center_z_mm: -.2 } } },
})
const expectedStraight = {
  reduction: 'straightened-stages', sections: 12, lanes: expectedBase.lanes,
  channelReference: { sourcePortId: 'g0' }, extraction: expectedExtraction,
  passiveComponents: [{ sourceComponentId: 'rterm' }],
  profiles: { top: { spacingMm: .75, relativePermittivity: 2.55,
    return: { widthMm: 2, thicknessMm: .035, lengthFactor: 1, centerYMm: 0, centerZMm: -.2 } } },
}

test('raw routed-copper channel equals handwritten modeling and survives old record validation', () => {
  const cj = [experiment()], before = structuredClone(cj)
  validateCircuitRecords(cj)
  assert.deepEqual(cj, before)
  assert.deepEqual(modelingFromCircuitJson(cj), expectedBase)
  const fallback = channel(); delete fallback.relative_permittivity; delete fallback.via_plating_thickness_mm
  const expected = structuredClone(expectedBase); delete expected.relativePermittivity; delete expected.viaPlatingMm
  assert.deepEqual(modelingFromCircuitJson([experiment(fallback)]), expected, 'stackup defaults are left to geometry')
})
test('straightened profiles, passive IDs and case-insensitive IBIS hashes map to handwritten modeling', () => {
  const hash = 'AB'.repeat(32)
  const cj = [experiment(straightChannel()), { type: 'simulation_ibis_model',
    ibis_model_asset: { project_relative_path: 'models/test.ibs', sha256: hash } }]
  assert.deepEqual(modelingFromCircuitJson(cj), { ...expectedStraight, ibisModelAssetSha256: { 'models/test.ibs': hash.toLowerCase() } })
})
test('shared extraction ignores object key order and rejects different or absent channels', () => {
  const c = channel()
  assert.deepEqual(modelingFromCircuitJson([experiment(c), experiment(Object.fromEntries(Object.entries(c).reverse()), 'second')]), expectedBase)
  for (const cj of [[], [experiment(undefined)].map(e => { delete e.pcb_spice_channel; return e }),
    [experiment(), experiment({ ...channel(), sections: 2 }, 'second')],
    [experiment(), experiment(null, 'second')]]) assert.throws(() => modelingFromCircuitJson(cj), /pcb_spice_channel/)
  assert.throws(() => modelingFromCircuitJson([experiment(), { ...experiment(), pcb_spice_channel: undefined }]), /missing pcb_spice_channel/)
})
test('malformed channel fields fail with local field diagnostics', () => {
  for (const [mutate, field] of [
    [c => c.sections = 0, 'sections'], [c => c.lanes[0].driver_source_port_id = '', 'driver_source_port_id'],
    [c => c.extraction.filaments = 1.5, 'filaments'],
    [c => c.extraction.model_frequency_hz = 1e10, 'extraction'],
    [c => c.extraction.refinement_filaments = 1, 'refinement_filaments'],
    [c => delete c.extraction.ground_mesh_size_mm, 'ground_mesh_size_mm'],
    [c => c.lanes[1].name = c.lanes[0].name, 'lanes'],
  ]) {
    const c = channel(); mutate(c)
    assert.throws(() => modelingFromCircuitJson([experiment(c)]), new RegExp(`pcb_spice_channel.*${field}`))
  }
  const c = straightChannel(); delete c.straightened_stage_profiles
  assert.throws(() => modelingFromCircuitJson([experiment(c)]), /straightened_stage_profiles/)
})
test('runPipeline derives modeling, uses serialized supplies, and explicit modeling overrides circuit channels', async () => {
  const input = inMemoryInput(), c = straightChannel(); delete c.passive_source_component_ids
  input.circuitJson.find(record => record.type === 'simulation_experiment').pcb_spice_channel = c
  input.circuitJson.push({ type: 'simulation_voltage_source', simulation_voltage_source_id: 'vdd',
    is_dc_source: false, terminal1_source_port_id: 'v0', terminal2_source_port_id: 'g0', voltage: 3.3 })
  const { modeling, ...rest } = input
  const result = await runPipeline({ ...rest, runSolver: fixtureSolver })
  const expected = { ...expectedStraight }; delete expected.passiveComponents
  assert.deepEqual(result.modeling, expected)
  assert.match(result.files['experiments/run/simulation.cir'], /VPHYSICAL0/)
  input.circuitJson.find(record => record.type === 'simulation_experiment').pcb_spice_channel = { invalid: true }
  const explicit = { ...modeling }; delete explicit.supplies
  const override = await runPipeline({ ...input, modeling: explicit, runSolver: fixtureSolver })
  assert.deepEqual(override.modeling, explicit)
  await assert.rejects(runPipeline({ ...rest, runSolver: fixtureSolver }), /pcb_spice_channel/)
})

test('derived modeling verifies hashes only where declared, retaining explicit hash-map requirements', async () => {
  const { modeling, ...input } = inMemoryInput()
  const c = straightChannel(); delete c.passive_source_component_ids
  input.circuitJson.find(record => record.type === 'simulation_experiment').pcb_spice_channel = c
  input.circuitJson.push({ type: 'simulation_voltage_source', simulation_voltage_source_id: 'vdd',
    is_dc_source: false, terminal1_source_port_id: 'v0', terminal2_source_port_id: 'g0', voltage: 3.3 })
  const models = input.circuitJson.filter(record => record.type === 'simulation_ibis_model')
  models[0].ibis_model_asset.sha256 = sha256(input.ibisSources['models/test.ibs']).toUpperCase()
  models[1].ibis_model_asset.project_relative_path = 'models/other.ibs'
  input.ibisSources['models/other.ibs'] = input.ibisSources['models/test.ibs']
  await runPipeline({ ...input, runSolver: fixtureSolver })
  models[0].ibis_model_asset.sha256 = '0'.repeat(64)
  await assert.rejects(runPipeline({ ...input, runSolver: fixtureSolver }), /vendor_hash.*bytes differ/)
  models[0].ibis_model_asset.sha256 = 'bad'
  assert.throws(() => modelingFromCircuitJson(input.circuitJson), /vendor_hash.*64-digit/)
  models[0].ibis_model_asset.sha256 = 'A'.repeat(64)
  models[1].ibis_model_asset.project_relative_path = 'models/test.ibs'
  models[1].ibis_model_asset.sha256 = 'B'.repeat(64)
  assert.throws(() => modelingFromCircuitJson(input.circuitJson), /vendor_hash.*conflicting/)
})
