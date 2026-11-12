import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { prepareBlocks } from '../../src/pipeline/signals'
import { routedSimulation } from '../../src/pipeline'
import { sha256 } from '../../src/kernel'
import { renderCoreSignals } from './core-render'

test('TSX two-trace routed compiler deck oracle before stage migration', { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed' }, async () => {
  const circuit = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
  assert.equal(sha256(bytes), '03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00', 'oracle uses the same vendor revision')
  const [block] = prepareBlocks(circuit, { 'models/sn74lvc1g04.ibs': bytes }, '2d', 1)
  const result = routedSimulation(block, { 'models/sn74lvc1g04.ibs': bytes }, { riseSeconds: 1e-9, refinement: 1, durationSeconds: 4e-9, stepSeconds: 1e-11 })
  assert.equal(result.geometry.wires.length, 2)
  assert.equal(result.extracted.slices[0].wires.length, 2)
  assert.equal(sha256(result.deck), 'bc639ab7abfe945e62fcd6689c8ab6d63e7f4536c93ecdce12e7654f8805e6d5', 'full deck bytes, including native vendor compilation and coupling')
})
