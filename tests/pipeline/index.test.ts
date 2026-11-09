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
