import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import Board from '../fixtures/return-agreement'
import { modeling } from '../fixtures/native-channel'
import { renderCoreSignals } from '../support/core-render'
import { geometryFromCircuitJson } from '../../src/board'
import { extractRouteReturn, loopImpedance } from '../../src/extraction'
import { rootScope } from '../../src/kernel'

test('TSX return extraction completes the primitive energy square without native C or fitted waveform data', async () => {
  const circuit = await renderCoreSignals(<Board />)
  const settings = { ...modeling, relativePermittivity: undefined, lanes: [0, 1, 2].map(i => ({ port: `S${i}`, from: { component: 'TX', port: `S${i}` }, to: { component: 'RX', port: `S${i}` } })) }
  const geometry = geometryFromCircuitJson(circuit, settings)
  // Analytic positive primitive matrices are an algebra oracle, not native physical evidence.
  const R = [[1, .1, .1, .05], [.1, 1, .1, .05], [.1, .1, 1, .05], [.05, .05, .05, .5]]
  const L = R.map(row => row.map(value => value * 1e-8))
  const header = R.map((_, i) => `Row ${i + 1}: N${i}a to N${i}b`).join('\n')
  const body = R.map((row, i) => row.map((value, j) => `${value} ${L[i][j] * 2 * Math.PI * settings.extraction.modelHz}j`).join(' ')).join('\n')
  let calls = 0
  for (const model of ['closure', 'series'] as const) {
    const result = await extractRouteReturn(geometry, settings, rootScope('extraction'), { progress: () => {}, runSolver: async request => {
      calls++
      assert.equal(request.solver, 'fasthenry')
      return { stdout: '', stderr: '', files: { 'Zc.mat': `${header}\nImpedance matrix for frequency = ${settings.extraction.modelHz} 4 x 4\n${body}` } }
    } }, model)
    assert.equal(result.value.model, model)
    assert.equal(result.value.traces.length, 3)
    for (const [kind, matrix] of [['R', R], ['L', L]] as const) {
      const loop = loopImpedance(matrix)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const shorted = matrix[i][j] - matrix[i][3] * matrix[3][j] / matrix[3][3]
        const expected = model === 'series' ? loop[i][j] : loop[i][j] - shorted
        assert.ok(Math.abs(result.value[kind][i][j] - expected) <= Math.abs(expected) * 1e-12)
      }
    }
    assert.deepEqual(result.value.convergence, { R: 0, L: 0 })
  }
  assert.equal(calls, 4)
})
