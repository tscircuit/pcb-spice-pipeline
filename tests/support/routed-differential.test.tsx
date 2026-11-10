import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Differential from '../../examples/level1-differential/level1-differential'
import { prepareBlocks } from '../../src/pipeline/signals'
import { routedSimulation } from '../../src/pipeline'
import { renderCoreSignals } from './core-render'

test('TSX differential receiver can share its physical pin with a routed termination stub', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuit = await renderCoreSignals(<Differential />)
  const sources = { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`) }
  const [block] = prepareBlocks(circuit, sources, '2d')
  assert.equal(block.settings.lanes.length, 4, 'two bus routes and two termination stubs')
  const result = routedSimulation(block, sources, { riseSeconds: 1e-9, refinement: 1, durationSeconds: 1e-6, stepSeconds: 1e-10 })
  assert.equal(result.probes.length, 3, 'differential receiver and both physical legs')
  assert.match(result.deck, /R.*120/m, 'physical termination remains in the circuit')
})
