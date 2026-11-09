import React from 'react'
import { readFile, writeFile } from 'node:fs/promises'
import { renderSignals } from '../tests/support/signal-render'
import { renderCoreSignals } from '../tests/support/core-render'
import { runPipeline } from '../src'
import DDR3 from '../examples/levels/level4-ddr3-write'

// Coupled-package admission precedes route/extraction admission. Avoid the bounded-out
// BGA autoroute in this independent source preflight; never claim this is a full layout.
const tree = React.cloneElement(DDR3(), { routeRemaining: false })
const circuitJson = await renderSignals(tree, ['pcb_trace_missing_error', 'pcb_port_not_connected_error'])
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
  let realCoreError: string | undefined
  if (process.env.SI_CORE_MODULE) {
    try {
      await renderCoreSignals(tree)
    } catch (error) {
      realCoreError = (error as Error).message
    }
    if (realCoreError !== message) throw new Error(`Core source preflight disagrees: ${realCoreError}`)
  }
  const summary = { status: 'expected_error', rendering: 'source_preflight_routeRemaining_false_not_full_layout', error: message, real_core_error: realCoreError, native_solver_calls: calls }
  await writeFile('runs/ddr3-boundary.json', JSON.stringify(summary, null, 2) + '\n')
  console.log(summary)
}
