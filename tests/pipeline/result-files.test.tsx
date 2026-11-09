import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderSignals } from '../support/signal-render'
import { signalResultFiles } from '../../src/pipeline/result-files'
import { jsonBody } from '../../src/kernel'
import type { CircuitJson } from '../../src/board'

test('oversized TSX result artifacts preserve every waveform sample, record and position across indexed parts', async () => {
  const records: CircuitJson = await renderSignals(<board width="10mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0402" /></board>)
  records.splice(1, 0, { type: 'simulation_signal_waveform', simulation_signal_waveform_id: 'wave', simulation_signal_id: 'signal', source_port_id: 'port', end: 'far', timestamps_s: [0, 1e-9, 2e-9], voltage_levels: [0, 3.3, -.1] })
  /** Exercise the actual string-limit fallback without allocating a half-gigabyte test string. */
  const limited = (value: unknown): string => {
    if (value === records) throw new RangeError('Invalid string length')
    return jsonBody(value)
  }
  const files = signalResultFiles(records, limited)
  const index = JSON.parse(files['circuit-results.index.json']) as { parts: { file: string; indices: number[] }[] }
  const restored: CircuitJson = []
  for (const part of index.parts) JSON.parse(files[part.file]).forEach((record: CircuitJson[number], i: number) => {
    restored[part.indices[i]] = record
  })
  assert.deepEqual(restored, records)
  assert.deepEqual(signalResultFiles(records), { 'circuit-results.json': jsonBody(records) })
  assert.throws(() => signalResultFiles(records, () => {
    throw new TypeError('bad JSON')
  }), /bad JSON/)
})
