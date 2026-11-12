import React from 'react'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import DDR3 from '../examples/level4-ddr3-write/level4-ddr3-write'
import { renderCoreSignals } from '../tests/support/core-render'
import { parsePackageModel } from '../src/buffers/package-model'
import { prepareBlocks } from '../src/pipeline/signals'
import { admit, declare, bind } from '../src/pipeline/stages'
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
const margins = model.C.map((row, i) => row[i] - row.reduce((sum, value, j) => sum + (i === j ? 0 : Math.abs(value)), 0))
const summary = {
  status: 'raw_vendor_corrected', raw_admission_error: null, native_solver_calls: 0,
  source_sha256: createHash('sha256').update(bytes).digest('hex'),
  dram_source_sha256: createHash('sha256').update(dram).digest('hex'),
  waveform_inspection: ddr3Waveforms(raw, dram.toString()),
  package_pin_count: model.pins.length,
  positive_coupling_pairs: model.C.reduce((sum, row, i) => sum + row.filter((value, j) => j > i && value > 0).length, 0),
  diagonally_dominant_rows: margins.filter(value => value >= 0).length,
  minimum_diagonal_margin_f: Math.min(...margins),
  core_signals: circuit.filter(record => record.type === 'simulation_signal').length,
  physical_records: Object.fromEntries(['pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuit.filter(record => record.type === type).length])),
}

const [block] = prepareBlocks(circuit, sources)
const context = { progress: (): void => {} }
const passed = ['prepareBlocks']
let nextStage = 'admit'
let firstError: string | null = null
const warnings = [...block.warnings]
let switching: object[] = []
try {
  const admitted = (await admit.run({ phase: 'input', options: { circuitJson: block.circuit, modeling: block.settings, ibisSources: sources } }, context)).state
  passed.push('admit')
  nextStage = 'declare'
  const declared = (await declare.run(admitted, context)).state
  passed.push('declare')
  nextStage = 'bind'
  const bound = (await bind.run(declared, context)).state
  passed.push('bind')
  nextStage = 'extract (not invoked)'
  switching = bound.compiled.flatMap((models, experiment) => models.flatMap(converted =>
    (converted.metadata.switchingTails ?? []).map(tail => ({ experiment, component: converted.name, ...tail }))))
  warnings.push(...bound.compiled.flatMap(models => models.flatMap(model => model.warnings)))
} catch (error) { firstError = (error as Error).message }
const diagnostic = { status: 'production_sign_correction', warnings, passed_stages: passed, next_stage: nextStage, first_error: firstError,
  stopped_before_native_extraction: true, switching_tails: switching }
await mkdir('runs', { recursive: true })
await writeFile('runs/ddr3-boundary.json', JSON.stringify({ ...summary, diagnostic }, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, diagnostic }, null, 2))
