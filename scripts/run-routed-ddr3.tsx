import React from 'react'
import { Circuit } from '@tscircuit/core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { getSvgFromGraphicsObject, type GraphicsObject } from 'graphics-debug'
import { Resvg } from '@resvg/resvg-js'
import { RoutedPipelineSolver } from '../src/pipeline'
import { createNativeSolver } from '../src/adapters'
import { routeWaveformDrawing } from '../src/simulation'
import { sha256 } from '../src/kernel'
import type { CircuitJson } from '../src/board'
import Board from '../examples/level4-ddr3-write/level4-ddr3-write'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'

// Every artifact can contain local board/model data: write only to an ignored or external directory.
const output = resolve(process.env.SI_STAGE_VISUALS_DIR ?? '.cache/ddr-level4')
const directory = process.env.IBIS_MODEL_DIR ?? 'models'
const ibisSources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(join(directory, file), 'utf8')])))
await mkdir(output, { recursive: true })
/** Save the stage's actual drawing, including an explicit failed state when no capture exists. */
async function render(name: string, drawing: GraphicsObject): Promise<void> {
  const svg = getSvgFromGraphicsObject(drawing, { svgWidth: 1800, svgHeight: 1400, includeTextLabels: false, backgroundColor: 'white' })
  await writeFile(join(output, `${name}.svg`), svg)
  await writeFile(join(output, `${name}.png`), new Resvg(svg, { font: { defaultFontFamily: 'Arial' } }).render().asPng())
}
let circuitJson: CircuitJson
if (process.argv.includes('--addr-cmd')) {
  const physical = JSON.parse(await readFile(process.env.SI_DDR3_BOARD ?? join(directory, 'ddr3-board.json'), 'utf8')) as CircuitJson
  circuitJson = await withDdr3Signals(physical, ibisSources, { block: 'DDR3_ADDR_CMD' })
} else {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async url => new Response(ibisSources[`models/${String(url).split('/').at(-1)}`]) } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  circuitJson = circuit.getCircuitJson() as CircuitJson
  const errors = circuitJson.filter(record => record.type.endsWith('_error'))
  if (errors.length) throw new Error(JSON.stringify(errors))
}
const native = createNativeSolver({ timeoutMs: 45 * 60 * 1000 })
let invocations = 0
let nativeMilliseconds = 0
const started = performance.now()
const timings: Record<string, number> = {}
const stats: Record<string, unknown> = {}
let stageStart = started
const root = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, {
  progress: console.log,
  runSolver: async request => {
    if (++invocations !== 1 || request.solver !== 'ngspice') throw new Error('DDR evidence allows exactly one ngspice invocation')
    await writeFile(join(output, 'simulation.cir'), request.files['simulation.cir'])
    const start = performance.now()
    try {
      const result = await native(request)
      await writeFile(join(output, 'ngspice.stdout.log'), result.stdout)
      await writeFile(join(output, 'ngspice.stderr.log'), result.stderr)
      return result
    } finally { nativeMilliseconds = performance.now() - start }
  },
})
let last = started
try {
  while (!root.solved) {
    const name = root.getCurrentStageName()
    await root.stepAsync()
    const solver = root.getSolver(name)!
    if (solver.solved) {
      timings[name] = performance.now() - stageStart
      stats[name] = solver.stats
      stageStart = performance.now()
      console.log('Completed', name, timings[name], solver.stats)
      if (name === 'RouteNetworkSolver') {
        const compiled = root.stageOutput('RouteNetworkSolver').value[0]
        await writeFile(join(output, 'evidence.json'), JSON.stringify(compiled.evidence))
        await writeFile(join(output, 'compile.json'), JSON.stringify({ cells: compiled.evidence.cells, deckBytes: Buffer.byteLength(compiled.deck), deckSha256: sha256(compiled.deck), qualification: 'compiled-only' }, null, 2))
      }
    }
    if (performance.now() - last > 15000) {
      console.log('Progress', name, solver.stats, { rssBytes: process.memoryUsage().rss })
      last = performance.now()
    }
  }
  const block = root.getOutput().blocks[0]
  await writeFile(join(output, 'capture.json'), JSON.stringify(block.capture))
  await writeFile(join(output, 'evidence.json'), JSON.stringify(block.compiled.evidence))
  const stage = root.getSolver('RouteTransientSolver')!
  await render('stage-6', stage.visualize())
  const probes = block.capture.probes.map(probe => ({ name: probe.name, minimumV: probe.voltageLevels.reduce((minimum, value) => Math.min(minimum, value), Infinity), maximumV: probe.voltageLevels.reduce((maximum, value) => Math.max(maximum, value), -Infinity), finalV: probe.voltageLevels.at(-1), finite: probe.voltageLevels.every(Number.isFinite) }))
  await writeFile(join(output, 'waveform-sanity.json'), JSON.stringify(probes, null, 2))
  console.log('Completed candidate-unqualified', { cells: block.compiled.evidence.cells, deckBytes: Buffer.byteLength(block.compiled.deck), deckSha256: sha256(block.compiled.deck), probes })
} catch (error) {
  const stage = root.getSolver('RouteTransientSolver')
  const reason = String(error).split(/\r?\n/).find(line => /timestep too small|fatal|aborted/i.test(line)) ?? String(error).split(/\r?\n/, 1)[0].slice(0, 240)
  if (stage) await render('stage-6-failed', routeWaveformDrawing(undefined, root.stageOutput('RouteNetworkSolver').value[0].durationSeconds, reason))
  await writeFile(join(output, 'failure.log'), String(error))
  await writeFile(join(output, 'failure.json'), JSON.stringify({ stage: root.getCurrentStageName(), error: reason, capture: 'No completed waveform' }, null, 2))
  throw error
} finally {
  await writeFile(join(output, 'timing.json'), JSON.stringify({ complete: root.solved, stage: root.getCurrentStageName(), wallMilliseconds: performance.now() - started, nativeMilliseconds, invocations, timings, stats, nodePeakRssKiB: process.resourceUsage().maxRSS }, null, 2))
}
