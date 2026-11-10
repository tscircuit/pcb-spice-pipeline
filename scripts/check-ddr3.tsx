import React from 'react'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import DDR3 from '../examples/level4-ddr3-write/level4-ddr3-write'
import { renderCoreSignals } from '../tests/support/core-render'
import { parsePackageModel } from '../src/buffers/package-model'
import { prepareBlocks } from '../src/pipeline/signals'
import { admit, declare, bind } from '../src/pipeline/stages'
import { compileBuffers } from '../src/buffers'
import { modelRunDefinition, type PipelineIbisModel } from '../src/simulation'
import { ddr3Waveforms } from './inspect-ddr3-waveforms'

// Real core, unchanged DDR3 TSX, and no RunSolver capability anywhere in this check.
const circuit = await renderCoreSignals(<DDR3 />)
assert.equal(circuit.filter(record => record.type === 'simulation_signal').length, 9)
const directory = process.env.IBIS_MODEL_DIR ?? 'models'
const bytes = await readFile(`${directory}/sprm552c.ibs`)
const dram = await readFile(`${directory}/W631GG6MB-12.ibs`)
const sources = { 'models/sprm552c.ibs': bytes, 'models/W631GG6MB-12.ibs': dram }
const raw = bytes.toString()
const model = parsePackageModel(raw, 'am335x_zcz')
const signError = 'am335x_zcz: Maxwell capacitance has positive off-diagonal entries; vendor sign conversion is forbidden'
assert.throws(() => prepareBlocks(circuit, sources), { message: signError })
const margins = model.C.map((row, i) => row[i] - row.reduce((sum, value, j) => sum + (i === j ? 0 : Math.abs(value)), 0))
const summary = {
  status: 'raw_vendor_rejected', raw_admission_error: signError, native_solver_calls: 0,
  source_sha256: createHash('sha256').update(bytes).digest('hex'),
  dram_source_sha256: createHash('sha256').update(dram).digest('hex'),
  waveform_inspection: ddr3Waveforms(raw, dram.toString()),
  package_pin_count: model.pins.length,
  positive_coupling_pairs: model.C.reduce((sum, row, i) => sum + row.filter((value, j) => j > i && value > 0).length, 0),
  diagonally_dominant_rows: margins.filter(value => value >= 0).length,
  minimum_diagonal_margin_f: Math.min(...margins),
  core_signals: circuit.filter(record => record.type === 'simulation_signal').length,
  physical_records: Object.fromEntries(['pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuit.filter(record => record.type === type).length])),
  diagnostic: undefined as object | undefined,
}

// Opt-in counterfactual only: do not edit vendor bytes or add a production sign heuristic.
// This tests what follows a vendor-confirmed sign correction, not raw-source acceptance.
if (process.env.SI_DIAGNOSTIC_MAXWELL_SIGNS === '1') {
  const capacitance = '[Capacitance Matrix] Sparse_matrix\n' + model.pins.map((pin, i) =>
    `[Row] ${pin}\n` + model.C[i].slice(i).map((value, j) => `${model.pins[i + j]} ${j === 0 ? value : -value}`).join('\n')).join('\n') + '\n'
  const start = raw.indexOf('[Capacitance Matrix]', raw.indexOf('[Define Package Model]'))
  const end = raw.indexOf('[End Model Data]', start)
  assert.ok(start >= 0 && end > start)
  const candidate = raw.slice(0, start) + capacitance + raw.slice(end)
  const candidateSources = { ...sources, 'models/sprm552c.ibs': candidate }
  const [block] = prepareBlocks(circuit, candidateSources)
  const context = { progress: (): void => {} }
  const admitted = (await admit.run({ phase: 'input', options: { circuitJson: block.circuit, modeling: block.settings, ibisSources: candidateSources } }, context)).state
  const declared = (await declare.run(admitted, context)).state
  // Static pin states exercise both real chip package assemblies without the
  // switching-waveform rejection or any transient/extraction solver.
  const [packages] = compileBuffers(declared.buffers, declared.experiments.plans.slice(0, 1), (model: PipelineIbisModel, plan) => {
    const input = modelRunDefinition(model, plan)
    input.run.stimuli = Object.fromEntries(Object.entries(input.run.stimuli).map(([port, stimulus]) => [port,
      { ...stimulus, initialState: 0 as const, pattern: { ...stimulus.pattern, bits: '0' } }]))
    return input
  })
  assert.equal(packages.length, 2)
  const bound = (await bind.run(declared, context)).state
  assert.equal(bound.phase, 'bound')
  const switching = bound.compiled.flatMap((models, experiment) => models.flatMap(converted =>
    (converted.metadata.switchingTails ?? []).map(tail => ({ experiment, component: converted.name, ...tail }))))
  assert.ok(switching.length > 0)
  summary.diagnostic = {
    status: 'counterfactual_sign_correction_only',
    source_sha256: createHash('sha256').update(candidate).digest('hex'),
    derived_blocks: 1, passed_stages: ['admit', 'declare', 'bind'], next_stage: 'extract', next_error: null,
    stopped_before_native_extraction: true, switching_tails: switching,
    static_packages: packages.map(converted => ({ component: converted.name, matrix_pins: converted.metadata.packageData.matrices?.pins,
      reference_pins: converted.metadata.packageData.mappedPins.filter(pin => pin.role === 'reference') })),
  }
}
await mkdir('runs', { recursive: true })
await writeFile('runs/ddr3-boundary.json', JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
