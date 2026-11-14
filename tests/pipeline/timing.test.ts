import test from 'node:test'
import assert from 'node:assert/strict'
import { recordingTime, compareNames } from '../../src/pipeline/timing'
import type { SimulationSignal } from '../../src/board'

/** Minimal resolved intent for pure timing arithmetic; no hand-authored electrical circuit. */
const signal = (pattern: string, rate: number, offset: number = 0): SimulationSignal => ({ type: 'simulation_signal', simulation_signal_id: 's', simulation_signal_integrity_id: 'b', name: 'DATA',
  driver: { source_port_id: 'tx' }, receivers: [{ source_port_id: 'rx' }], pattern, seed: 127, bit_rate_bps: rate, offset_s: offset })

test('automatic capture is startup plus 128 slowest UI, independent of pattern period', () => {
  assert.deepEqual(recordingTime([signal('clock', 1)]), { duration: 144, gate: 16 })
  assert.deepEqual(recordingTime([signal('prbs31', 2, 3), signal('00110', 1)]), { duration: 144, gate: 16 })
  assert.equal(recordingTime([signal('clock', 2, 3)]).duration, 75)
  for (const pattern of ['0', '1', '000', '111']) assert.equal(recordingTime([signal(pattern, 2, 100)]).duration, 16)
  assert.equal(recordingTime([{ ...signal('prbs31', 2, 100), driver_disabled: true }]).duration, 16)
})

test('source signal names use Unicode code point order', () => {
  assert.ok(compareNames('\uE000', '\u{10000}') < 0)
})
