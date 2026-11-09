import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import Board, { modeling } from '../fixtures/layered-microstrip'
import { renderCoreSignals } from '../support/core-render'
import { geometryFromCircuitJson } from '../../src/board'
import { fasterCapDeck, parseFasterCap, validateMatrix } from '../../src/extraction'
import { createNativeSolver } from '../../src/adapters'

for (const coupled of [false, true]) test(`layered TSX ${coupled ? 'coupled' : 'single'} microstrip primitive capacitance is reciprocal`, {
  skip: process.env.SI_TEST_NATIVE_CAPACITANCE !== '1', timeout: 180000,
}, async () => {
  const circuit = await renderCoreSignals(React.createElement(Board, { coupled }))
  const settings = { ...modeling, lanes: modeling.lanes.slice(0, coupled ? 2 : 1) }
  const cell = geometryFromCircuitJson(circuit, settings).cells[0]
  const solver = createNativeSolver({ timeoutMs: 150000, tools: { fastercap: '/opt/homebrew/bin/FasterCap' } })
  const run = await solver({ solver: 'fastercap', args: ['channel.lst', '-b', '-a0.02', '-ap', '-e'], files: fasterCapDeck(cell, settings.extraction), outputFiles: [] })
  const raw = parseFasterCap(run.stdout).matrix
  assert.equal(raw.length, coupled ? 3 : 2)
  validateMatrix(raw, 'C primitive', settings.extraction.reciprocityTolerance)
})
