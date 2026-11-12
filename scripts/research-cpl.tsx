import React from 'react'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TwoTraceBoard } from '../examples/routed/two-trace-board'
import Differential from '../examples/level1-differential/level1-differential'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'
import { renderCoreSignals } from '../tests/support/core-render'
import { RoutedPipelineSolver, type RoutedStageSolver } from '../src/pipeline'
import { RouteNetworkSolver, type RouteNetworkInput, type RoutedDeck } from '../src/simulation'
import { compileRouteCpl } from '../src/simulation/route-cpl'
import type { CircuitJson } from '../src/board'

// Compilation only: native execution must separately use the shared machine lock.
const name = process.argv[2] ?? 'two-trace'
const output = resolve(process.env.SI_CPL_EVIDENCE_DIR ?? '.cache/cpl', name)
const models = process.env.IBIS_MODEL_DIR ?? 'models'
await mkdir(output, { recursive: true })
const files = name.startsWith('ddr') ? ['sprm552c.ibs', 'W631GG6MB-12.ibs'] : [name === 'differential' ? 'sn65hvd72.ibs' : 'sn74lvc1g04.ibs']
const ibisSources = Object.fromEntries(await Promise.all(files.map(async file => [`models/${file}`, await readFile(join(models, file), 'utf8') ])))
let circuitJson: CircuitJson
if (name.startsWith('ddr')) {
  circuitJson = await withDdr3Signals(JSON.parse(await readFile(process.env.SI_DDR3_BOARD ?? join(models, 'ddr3-board.json'), 'utf8')), ibisSources, { block: 'DDR3_ADDR_CMD', durationSeconds: 1e-9, nets: name === 'ddr-full' ? undefined : ['A4'] })
} else if (name === 'differential') {
  // Same physical differential example, with a short declared 10 Mbps experiment.
  const tree = Differential()
  circuitJson = await renderCoreSignals(React.cloneElement(tree, {}, ...React.Children.toArray(tree.props.children).map(child => React.isValidElement<Record<string, unknown>>(child) && child.props.bitRate ? React.cloneElement(child, { bitRate: '10Mbps', duration: 400e-9 }) : child)))
} else circuitJson = await renderCoreSignals(<TwoTraceBoard />)
const root = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, {
  progress: (): void => undefined,
  runSolver: async (): Promise<never> => { throw new Error('Research compiler must never spawn ngspice') },
})
root.solveUntilStage('RouteNetworkSolver')
const stage = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!
const input = stage.getConstructorParams()[0][0]
const summary: Record<string, unknown> = { name, extractedSlices: input.extracted.slices.length, maximumConductors: Math.max(...input.extracted.slices.map(slice => slice.wires.length)), conductorHistogram: input.extracted.slices.reduce<Record<string, number>>((counts, slice) => ({ ...counts, [slice.wires.length]: (counts[slice.wires.length] ?? 0) + 1 }), {}) }
const candidates = ['ladder', 'cpl'] as const
for (const candidate of candidates) {
  const started = performance.now()
  try {
    let compiled: RoutedDeck
    if (candidate === 'cpl') compiled = compileRouteCpl(input).value
    else {
      const solver = new RouteNetworkSolver(input)
      solver.solve()
      compiled = solver.getOutput().value
    }
    const directory = join(output, candidate)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'simulation.cir'), compiled.deck)
    await writeFile(join(directory, 'probes.json'), JSON.stringify(compiled.probes, null, 2))
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(compiled.evidence))
    summary[candidate] = { deckBytes: Buffer.byteLength(compiled.deck), compileMs: performance.now() - started, cells: compiled.evidence.cells, stepSeconds: compiled.stepSeconds, durationSeconds: compiled.durationSeconds, cplSections: compiled.deck.match(/^PROUTECPL/gm)?.length ?? 0, ltraSections: compiled.deck.match(/^OROUTECPL/gm)?.length ?? 0, kTerms: compiled.deck.match(/^K/gm)?.length ?? 0 }
  } catch (error) {
    summary[candidate] = { error: String(error), compileMs: performance.now() - started }
  }
}
await writeFile(join(output, 'compile.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
