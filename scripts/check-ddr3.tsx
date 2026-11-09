import React from 'react'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { simulation } from '@tscircuit/core'
import DDR3 from '../examples/level4-ddr3-write/level4-ddr3-write'
import { renderCoreSignals } from '../tests/support/core-render'
import { convertPackaged } from '../src/buffers/package'

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
// Package admission precedes any conversion or solver; the supplied run cannot be used.
assert.throws(() => convertPackaged(bytes, {
  definition: { source: { content: bytes.toString() }, component: model.ibis_component_name, pinMap: model.ibis_pin_name_to_source_port_id, corner: 'typical', packagePolicy: 'vendor' },
  run: { duration: 1e-9, pinStates: {}, stimuli: {} },
}), /coupled \[Package Model\] not implemented yet; scalar fallback is forbidden/)
await mkdir('runs', { recursive: true })
const summary = { status: 'expected_error', error: message, real_core_error: message, native_solver_calls: 0, physical_records: Object.fromEntries(['pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuit.filter(record => record.type === type).length])) }
await writeFile('runs/ddr3-boundary.json', JSON.stringify(summary, null, 2) + '\n')
console.log(summary)
