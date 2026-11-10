import React from 'react'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { simulation } from '@tscircuit/core'
import DDR3 from '../examples/level4-ddr3-write/level4-ddr3-write'
import { renderCoreSignals } from '../tests/support/core-render'
import { parseIbis } from '@tscircuit/ibis-to-spice'
import { coupledPackage } from '../src/buffers'
import { parsePackageModel } from '../src/buffers/package-model'
import { selectPackageModel } from '../src/buffers/package-matrix'

const message = '.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.'
await assert.rejects(renderCoreSignals(<DDR3 />), { message })
const tree = DDR3()
const physical = React.cloneElement(tree, {}, React.Children.toArray(tree.props.children).filter(child => !React.isValidElement(child) || child.type !== simulation.pcbtransientchannelsimulation))
const circuit = await renderCoreSignals(physical)
const cpu = circuit.find(record => record.type === 'source_component' && record.name === 'CPU')
if (cpu?.type !== 'source_component') throw new Error('Missing CPU')
const model = circuit.find(record => record.type === 'simulation_ibis_model' && record.source_component_id === cpu.source_component_id)!
if (model.type !== 'simulation_ibis_model') throw new Error('Missing CPU model')
const bytes = await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/sprm552c.ibs`)
// Core still has its own independent rejection. Render the unchanged physical TSX
// above and exercise the pipeline's package admission directly with its real map.
const next = 'am335x_zcz: selected package pin E5 missing from [Pin Numbers]; scalar fallback is forbidden'
const component = parseIbis(bytes.toString()).components[model.ibis_component_name]
assert.throws(() => coupledPackage(bytes.toString(), component, Object.keys(model.ibis_pin_name_to_source_port_id)), { message: next })
const packageModel = parsePackageModel(bytes.toString(), 'am335x_zcz')
const selected = Object.keys(model.ibis_pin_name_to_source_port_id)
const missing = selected.filter(pin => !packageModel.pins.includes(pin))
assert.deepEqual(missing.sort(), ['A1', 'E5'])
const signError = 'am335x_zcz: Maxwell capacitance has positive off-diagonal entries; vendor sign conversion is forbidden'
assert.throws(() => selectPackageModel(packageModel, selected.filter(pin => !missing.includes(pin))), { message: signError })
await mkdir('runs', { recursive: true })
const summary = { status: 'package_admission_advanced', pipeline_package_error: next, missing_reference_pins: missing, additional_vendor_error: signError, real_core_error: message, native_solver_calls: 0,
  package_pin_count: packageModel.pins.length, physical_records: Object.fromEntries(['pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuit.filter(record => record.type === type).length])) }
await writeFile('runs/ddr3-boundary.json', JSON.stringify(summary, null, 2) + '\n')
console.log(summary)
