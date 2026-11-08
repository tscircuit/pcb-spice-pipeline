import test from 'node:test'
import assert from 'node:assert/strict'
import { signalBits, endpointPorts, prepareBlocks } from '../../src/pipeline/signals'
import type { SimulationSignal } from '../../src/board'

const signal: SimulationSignal = { type: 'simulation_signal', simulation_signal_id: 's', simulation_signal_integrity_id: 'b', name: 'D',
  driver: { kind: 'single', source_port_id: 'a' }, receivers: [{ kind: 'single', source_port_id: 'b' }],
  bit_rate_bps: 1, pattern: 'prbs7', seed: 42, offset_s: 0, probe: 'local', mask: 'ibis' }

test('PRBS7 has a complete stable 127-bit period with decorrelated seeds', () => {
  const a = signalBits(signal, 127)
  assert.equal(a.length, 127)
  assert.equal(a.split('1').length - 1, 64)
  assert.equal(a, signalBits(signal, 1000))
  assert.notEqual(a, signalBits({ ...signal, seed: 41 }, 127))
  for (const pattern of ['prbs15', 'prbs31']) assert.equal(signalBits({ ...signal, pattern }, 20).length, 21)
  assert.throws(() => signalBits({ ...signal, seed: 0 }, 20), /nonzero/)
})

test('literal, clock and each explicit quiet state', () => {
  assert.equal(signalBits({ ...signal, pattern: '0011' }, 2), '0011')
  assert.equal(signalBits({ ...signal, pattern: 'clock' }, 10), '01')
  assert.equal(signalBits({ ...signal, quiet: 'high' }, 10), '1')
  assert.equal(signalBits({ ...signal, quiet: 'low' }, 10), '0')
  assert.throws(() => signalBits({ ...signal, pattern: '10x' }, 10), /pattern/)
  assert.deepEqual(endpointPorts({ kind: 'differential', p_source_port_id: 'p', n_source_port_id: 'n' }), ['p', 'n'])
})

test('the removed modeling API cannot supply a test or synthesize a block', () => {
  assert.throws(() => prepareBlocks([], {}), /modeling API has been removed/)
})
