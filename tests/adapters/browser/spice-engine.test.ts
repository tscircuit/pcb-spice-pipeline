import test from 'node:test'
import assert from 'node:assert/strict'
import type { ResultType } from 'eecircuit-engine'
import { runSpiceEngine, spiceEngineResult } from '../../../src/adapters/browser/spice-engine'
import { spiceProbeRows } from '../../../src/observation'

const result: ResultType = { dataType: 'real', header: '', numVariables: 2, variableNames: ['v(n)', 'time'], numPoints: 3, data: [{ name: 'v(n)', type: 'voltage', values: [0, .3, .1] }, { name: 'time', type: 'time', values: [0, 2e-10, 1e-9] }] }

test('engine API vectors use actual adaptive times and named probe values', () => {
  const output = spiceEngineResult(result, 1e-9, 'KLU transient complete', '')
  assert.deepEqual(spiceProbeRows(output.files['waveform.raw'], [{ signalNode: 'n', referenceNode: '0' }]), [[0, 0], [2e-10, .3], [1e-9, .1]])
})

test('engine rejects diagnostics, incomplete time coverage, complex data and nonfinite values', () => {
  for (const diagnostic of ['Error: bad device', 'fatal: rejected', 'transient aborted', 'timestep too small']) {
    assert.throws(() => spiceEngineResult(result, 1e-9, diagnostic, ''), { code: 'native_solver' })
    assert.throws(() => spiceEngineResult(result, 1e-9, '', diagnostic), { code: 'native_solver' })
  }
  for (const times of [[0, 2e-10, 5e-10], [1e-10, 2e-10, 1e-9], [0, NaN, 1e-9], [0, -1e-10, 1e-9], [0, 1e-9]]) assert.throws(() => spiceEngineResult({ ...result, data: [result.data[0], { name: 'time', type: 'time', values: times }] }, 1e-9, '', ''), /did not complete/)
  assert.throws(() => spiceEngineResult({ ...result, data: result.data.slice(0, 1) }, 1e-9, '', ''), /did not complete/)
  assert.throws(() => spiceEngineResult({ ...result, dataType: 'complex', data: [] }, 1e-9, '', ''), /real transient/)
  assert.throws(() => spiceEngineResult({ ...result, data: [{ ...result.data[0], values: [0, NaN, 1] }, result.data[1]] }, 1e-9, '', ''), /finite/)
})

test('engine admission rejects interactive or missing transient decks before initialization', async () => {
  for (const deck of ['title\n.end', 'title\n.tran 1e-9 -1\n.end', 'title\n.control\n.endc\n.tran 1e-11 1e-9\n.end']) await assert.rejects(runSpiceEngine(deck), { code: 'native_solver' })
})
