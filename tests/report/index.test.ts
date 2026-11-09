import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline, generateReport } from '../../src'

test('an empty SI result still produces a portable report', async () => {
  const result = await runPipeline({ circuitJson: [], ibisSources: {}, runSolver: async () => {
    throw Error('unexpected solver')
  } })
  assert.match(generateReport(result)['results.html'], /<!doctype html>/)
  assert.match(generateReport(result)['results.html'], /simulation-data/)
})
