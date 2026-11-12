import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Differential from '../../examples/level1-differential/level1-differential'
import { prepareBlocks } from '../../src/pipeline/signals'
import { RoutedAdmissionSolver, RoutedBlockSolver } from '../../src/pipeline'
import { renderCoreSignals } from './core-render'

test('TSX differential receiver can share its physical pin with a routed termination stub', { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn65hvd72.ibs; vendor bytes are not committed' }, async () => {
  const circuit = await renderCoreSignals(<Differential />)
  const sources = { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`, 'utf8') }
  const [block] = prepareBlocks(circuit, sources, '2d')
  assert.equal(block.settings.lanes.length, 4, 'two bus routes and two termination stubs')
  const admission = new RoutedAdmissionSolver({ circuitJson: circuit, ibisSources: sources })
  admission.solve()
  const port = { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('compiler test must not run ngspice')
  } }
  const solver = new RoutedBlockSolver({ ...admission.getOutput().value[0], context: port })
  solver.solveUntilStage('RouteTransientSolver')
  const result = solver.getStageOutput<{ value: import('../../src/simulation').RoutedDeck }>('RouteNetworkSolver')!.value
  assert.equal(result.probes.length, 3, 'differential receiver and both physical legs')
  assert.match(result.deck, /R.*120/m, 'physical termination remains in the circuit')
  const routes = result.evidence.routes as { sourceTraceId: string; length_mm: number }[]
  assert.equal(new Set(routes.map(route => route.sourceTraceId)).size, 2)
  assert.ok(routes.every(route => route.length_mm > 50), 'route evidence describes both long bus legs, rather than the termination stubs')
})
