import test from 'node:test'
import assert from 'node:assert/strict'
import { recordingTime, plannedSeed, compareNames } from '../../src/pipeline/timing'
import { signalBits } from '../../src/pipeline/signals'
import type { SimulationSignal } from '../../src/board'

/** Minimal resolved intent for pure timing arithmetic; no hand-authored electrical circuit. */
const signal = (pattern: string, rate: number, offset: number = 0): SimulationSignal => ({ type: 'simulation_signal', simulation_signal_id: 's', simulation_signal_integrity_id: 'b', name: 'DATA',
  driver: { kind: 'single', source_port_id: 'tx' }, receivers: [{ kind: 'single', source_port_id: 'rx' }], pattern, seed: 127, bit_rate_bps: rate, offset_s: offset, probe: 'local', mask: 'ibis' })

test('zero-offset clock records 19 UI; joint cycles use LCM rather than the largest period', () => {
  assert.deepEqual(recordingTime([signal('clock', 1)]), { duration: 19, gate: 16, period: 2 })
  assert.equal(recordingTime([signal('001', 2), signal('00110', 3)]).period, 15)
  assert.equal(recordingTime([signal('clock', 2, 3)]).duration, 12.5)
  assert.equal(recordingTime([{ ...signal('prbs7', 2), quiet: 'low' }]).duration, 16)
})

test('phase seeds match iterative generator states and cannot enter all-zero', () => {
  for (const pattern of ['prbs7', 'prbs15', 'prbs31']) {
    const names = [{ pattern, name: 'D2' }, { pattern, name: 'D0' }, { pattern, name: 'D1' }]
    const seeds = names.map(item => plannedSeed(pattern, item.name, names))
    assert.equal(new Set(seeds).size, 3)
    assert.ok(seeds.every(seed => seed >= 1 && seed < 2 ** Number(pattern.slice(4))))
    assert.equal(plannedSeed(pattern, 'D0', names), 2 ** Number(pattern.slice(4)) - 1)
  }
  const pattern = 'prbs7'
  const names = ['D0', 'D1', 'D2'].map(name => ({ pattern, name }))
  const all = signalBits({ ...signal(pattern, 1), seed: 127 }, 127)
  for (const [index, item] of names.entries()) {
    const shifted = signalBits({ ...signal(pattern, 1), seed: plannedSeed(pattern, item.name, names) }, 127)
    const phase = Math.floor(index * 127 / 3)
    assert.equal(shifted, all.slice(phase) + all.slice(0, phase))
  }
  assert.ok(compareNames('\uE000', '\u{10000}') < 0)
})
