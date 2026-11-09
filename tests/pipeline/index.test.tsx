import React from 'react'
import { readFile } from 'node:fs/promises'
import Single from '../../examples/levels/level1-single-ended'
import Differential from '../../examples/levels/level1-differential'
import { renderSignals } from '../support/signal-render'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline } from '../../src'
import { validateCircuitRecords } from '../../src/board'

test('a board without SI blocks returns an empty result without solver calls', async () => {
  const result = await runPipeline({ circuitJson: [], ibisSources: {}, runSolver: async () => {
    throw new Error('unexpected solver')
  } })
  assert.deepEqual(result.blocks, [])
  assert.deepEqual(result.simulationResultCircuitJson, [])
  assert.deepEqual(result.experiments, [])
})

test('official exported result schemas reject incompatible names and incomplete arrays', () => {
  const waveform = { type: 'simulation_signal_waveform', simulation_signal_waveform_id: 'wave', simulation_signal_id: 'signal', end: 'far', source_port_id: 'port', timestamps_s: [0, 1], voltage_levels: [0, 1] }
  validateCircuitRecords([waveform])
  assert.throws(() => validateCircuitRecords([{ ...waveform, timestamps_s: [0, 0] }]), /circuit_schema/)
  assert.throws(() => validateCircuitRecords([{ ...waveform, voltage_levels: [1] }]), /circuit_schema/)
  assert.throws(() => validateCircuitRecords([{ type: waveform.type, time_s: [0], voltage_v: [0] }]), /circuit_schema/)
})

test('synthetic transient IO covers public result schemas and retains only accepted refinement waveforms', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuitJson = (await renderSignals(<Single />)).filter(record => record.type !== 'pcb_trace')
  for (const record of circuitJson) if (record.type === 'simulation_signal_integrity') record.unrouted = 'ideal'
  const result = await runPipeline({ circuitJson, ibisSources: { 'models/sn74lvc1g04.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`) }, runSolver: async request => {
    assert.equal(request.solver, 'ngspice')
    const end = Number(/^tran \S+ (\S+)/m.exec(request.files['simulation.cir'])![1])
    const rows = Array.from({ length: 961 }, (_, i) => [i * end / 960, end < 2e-6 ? 3.3 : 3.3 * (Math.floor(i / 20) % 2)])
    return { stdout: '', stderr: '', files: { 'waveform.dat': 'time voltage\n' + rows.map(row => row.join(' ')).join('\n') + '\n' } }
  } })
  validateCircuitRecords(result.blocks[0].results)
  const eye = result.blocks[0].results.find(record => record.type === 'simulation_signal_eye')!
  assert.ok(eye.type === 'simulation_signal_eye' && eye.eye_height_v < 0, 'a wrong-bit waveform fails the transmitted-bit eye')
  const waveforms = Object.keys(result.files).filter(path => path.endsWith('/waveform.dat'))
  assert.equal(waveforms.length, 2, 'settled idle and accepted transient')
  assert.ok(waveforms.every(path => /undisturbed-idle|numerical-refinement-2/.test(path)))
  const convergence = JSON.parse(Object.entries(result.files).find(([path]) => path.endsWith('/numerical-convergence.json'))![1])
  assert.ok(convergence.checks.every((check: { previous_waveform_csv_sha256: string; waveform_csv_sha256: string }) => /^[a-f0-9]{64}$/.test(check.previous_waveform_csv_sha256) && /^[a-f0-9]{64}$/.test(check.waveform_csv_sha256)))
})

test('real I/O capability permits quiet-off and counts the alternate-charge idle solve', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuitJson = (await renderSignals(<Differential />)).filter(record => record.type !== 'pcb_trace')
  for (const record of circuitJson) {
    if (record.type === 'simulation_signal_integrity') record.unrouted = 'ideal'
    if (record.type === 'simulation_signal') record.quiet = 'off'
  }
  let calls = 0
  const result = await runPipeline({ circuitJson, ibisSources: { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`) }, runSolver: async request => {
    calls++
    assert.equal(request.solver, 'ngspice')
    const end = Number(/^tran \S+ (\S+)/m.exec(request.files['simulation.cir'])![1])
    return { stdout: '', stderr: '', files: { 'waveform.dat': `time far near\n0 0 0\n${end} 0 0\n` } }
  } })
  assert.equal(calls, 6, 'idle, two charge-basis trials, switching and two independent refinements')
  assert.equal(result.experiments[0].solverInvocations, calls)
  const noise = result.blocks[0].results.filter(record => record.type === 'simulation_signal_crosstalk')
  assert.deepEqual(noise.map(record => [record.end, record.idle_voltage_v, record.peak_positive_v, record.peak_negative_v]), [['far', 0, 0, 0], ['near', 0, 0, 0]])
  validateCircuitRecords(result.blocks[0].results)
})

test('an incomplete constant idle waveform cannot become a crosstalk reference', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuitJson = (await renderSignals(<Single />)).filter(record => record.type !== 'pcb_trace')
  for (const record of circuitJson) if (record.type === 'simulation_signal_integrity') record.unrouted = 'ideal'
  await assert.rejects(runPipeline({ circuitJson, ibisSources: { 'models/sn74lvc1g04.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`) }, runSolver: async request => {
    const end = Number(/^tran \S+ (\S+)/m.exec(request.files['simulation.cir'])![1])
    return { stdout: '', stderr: '', files: { 'waveform.dat': `time voltage\n0 3.3\n${end / 2} 3.3\n` } }
  } }), /Undisturbed idle transient did not complete the declared recording/)
})

test('a common-mode-only idle trial cannot hide a floating differential mode (synthetic charge oracle)', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuitJson = (await renderSignals(<Differential />)).filter(record => record.type !== 'pcb_trace')
  for (const record of circuitJson) {
    if (record.type === 'simulation_signal_integrity') record.unrouted = 'ideal'
    if (record.type === 'simulation_signal') record.quiet = 'off'
  }
  await assert.rejects(runPipeline({ circuitJson, ibisSources: { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`) }, runSolver: async request => {
    const deck = request.files['simulation.cir']
    const end = Number(/^tran \S+ (\S+)/m.exec(deck)![1])
    const trial = /^\.ic (.+)$/m.exec(deck)
    const charge = trial ? [...trial[1].matchAll(/v\([^)]+\)=([01])/g)].map(match => Number(match[1])) : [0, 0]
    const differential = charge[0] - charge[1]
    return { stdout: '', stderr: '', files: { 'waveform.dat': `time far near\n0 ${differential} ${differential}\n${end} ${differential} ${differential}\n` } }
  } }), /Floating quiet victim has no undisturbed idle operating point/)
})
