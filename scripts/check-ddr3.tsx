import React from 'react'
import { readFile, writeFile } from 'node:fs/promises'
import { renderSignals } from '../tests/support/signal-render'
import { runPipeline } from '../src'
import DDR3 from '../examples/levels/level4-ddr3-write'

const circuitJson = await renderSignals(<DDR3 />)
const ibisSources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`models/${file}`)])))
let calls = 0
try {
  await runPipeline({ circuitJson, ibisSources, runSolver: async () => {
    calls++
    throw new Error('Unexpected native solver before the coupled-package boundary')
  } })
  throw new Error('DDR3 must stop at the coupled-package boundary')
} catch (error) {
  const message = (error as Error).message
  if (message !== '.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.' || calls) throw error
  const summary = { status: 'expected_error', error: message, native_solver_calls: calls }
  await writeFile('runs/ddr3-boundary.json', JSON.stringify(summary, null, 2) + '\n')
  console.log(summary)
}
