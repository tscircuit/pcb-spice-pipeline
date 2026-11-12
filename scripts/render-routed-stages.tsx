import React from 'react'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getSvgFromGraphicsObject, type GraphicsObject } from 'graphics-debug'
import { Resvg } from '@resvg/resvg-js'
import { type BaseSolver } from '@tscircuit/solver-utils'
import { Circuit } from '@tscircuit/core'
import { RoutedAdmissionSolver, RoutedBlockSolver, RoutedPipelineSolver, routedStages, type RoutedProblem } from '../src/pipeline'
import { RouteNetworkSolver, routeWaveformDrawing } from '../src/simulation'
import { createNativeSolver } from '../src/adapters'
import { sha256 } from '../src/kernel'
import { routeText, type CircuitJson } from '../src/board'
import { TwoTraceBoard } from '../examples/routed/two-trace-board'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'

// All vendor assets, physical board JSON, decks and renders remain outside Git.
const output = resolve(process.env.SI_STAGE_VISUALS_DIR ?? '.cache/stage-visuals')
const models = resolve(process.env.IBIS_MODEL_DIR ?? 'models')
await mkdir(output, { recursive: true })
const manifest: Record<string, unknown> = {}

/** Rasterize the exact SVG returned by graphics-debug, with hover labels disabled. */
async function render(name: string, drawing: GraphicsObject): Promise<void> {
  const svg = getSvgFromGraphicsObject(drawing, { svgWidth: 1600, svgHeight: 1100, includeTextLabels: false, backgroundColor: 'white' })
  await writeFile(join(output, `${name}.graphics.json`), JSON.stringify(drawing))
  await writeFile(join(output, `${name}.svg`), svg)
  await writeFile(join(output, `${name}.png`), new Resvg(svg, { font: { defaultFontFamily: 'Arial' } }).render().asPng())
  const objects = Object.values(drawing).reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0)
  console.log(`${name}: ${objects} objects`)
  manifest[name] = { png: join(output, `${name}.png`), svg: join(output, `${name}.svg`), objects }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

/** Record each completed stage as it becomes available, without re-running the field extraction. */
async function stages(name: string, input: RoutedProblem): Promise<void> {
  const execute = name === 'two-trace' && process.argv.includes('--native-two-trace')
  const context = { runSolver: createNativeSolver({ timeoutMs: 10_000 }), progress: console.log }
  const root = new RoutedPipelineSolver(input, context)
  await render(`${name}-root-initial`, root.initialVisualize())
  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  await render(`${name}-0-admission`, admission.visualize())
  const plan = structuredClone(admission.getOutput().value[0])
  if (name === 'two-trace') plan.bindings.options = { riseSeconds: 1e-9, refinement: 1, durationSeconds: 40e-9, stepSeconds: 1e-11 }
  const block = new RoutedBlockSolver({ ...plan, context })
  const seen = new Set<string>()
  let progress = performance.now()
  while (!block.solved) {
    if (block.getCurrentStageName() === 'RouteTransientSolver' && !execute) {
      await render(`${name}-5-transient-pending`, routeWaveformDrawing(undefined, plan.bindings.options.durationSeconds))
      break
    }
    try {
      await block.stepAsync()
    } catch (error) {
      const stage = block.getCurrentStageName()
      const index = routedStages.findIndex((entry) => entry.solverName === stage)
      const solver = block.getSolver(stage)!
      if (stage === 'RouteTransientSolver') {
        await render(`${name}-5-transient-failed`, solver.visualize())
        throw error
      }
      await render(`${name}-${index}-network-rejected`, solver.visualize())
      const capture = routeWaveformDrawing(undefined, plan.bindings.options.durationSeconds)
      routeText(capture, 65, 153, 'Upstream network rejected; no deck to execute', '#dc2626', 2)
      await render(`${name}-5-capture-upstream-blocked`, capture)
      manifest[`${name}-blocked`] = { stage, reason: String(error), capture: 'pure drawing only; capture solver was not reached' }
      await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
      console.log(`${name}: BLOCKED ${String(error)}`)
      return
    }
    for (const stage of block.pipelineDef) {
      const solver = block.getSolver<BaseSolver>(stage.solverName)
      if (stage.solverName === 'RouteFieldsSolver' && !solver?.solved && solver?.stats.sections > 0 && !seen.has('fields-coupled')) {
        const drawing = solver.visualize()
        if (drawing.lines?.some((line) => line.strokeColor === '#9333ea')) {
          seen.add('fields-coupled')
          await render(`${name}-2-fields-coupled`, drawing)
        }
      }
      if (!solver?.solved || seen.has(stage.solverName)) continue
      seen.add(stage.solverName)
      if (stage.solverName === 'RouteFieldsSolver' || stage.solverName === 'RouteBindingsSolver')
        await writeFile(
          join(output, `${name}-${stage.solverName}.state.json`),
          JSON.stringify({ input: solver.getConstructorParams(), output: solver.getOutput() }),
        )
      const index = routedStages.findIndex((entry) => entry.solverName === stage.solverName)
      await render(`${name}-${index}-${['admission', 'sections', 'fields', 'bindings', 'network', 'transient'][index]}`, solver.visualize())
    }
    if (performance.now() - progress > 15_000) {
      console.log(`${name}: stepping ${block.getCurrentStageName()} ${JSON.stringify(block.getSolver(block.getCurrentStageName())?.stats)}`)
      progress = performance.now()
    }
  }
  const compiled = block.getSolver<RouteNetworkSolver>('RouteNetworkSolver')!.getOutput().value
  await writeFile(join(output, `${name}.evidence.json`), JSON.stringify(compiled.evidence))
  await writeFile(join(output, `${name}.cir`), compiled.deck)
  manifest[`${name}-deck`] = { bytes: Buffer.byteLength(compiled.deck), sha256: sha256(compiled.deck) }
  // Compile-only renders stop before stage 5; only a completed live run gets a final atlas.
  if (block.solved) await render(`${name}-root-final`, block.visualize())

}

const twoSource = await readFile(join(models, 'sn74lvc1g04.ibs'), 'utf8')
const core = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(twoSource) } })
core.add(<TwoTraceBoard />)
await core.renderUntilSettled()
await stages('two-trace', { circuitJson: core.getCircuitJson() as CircuitJson, ibisSources: { 'models/sn74lvc1g04.ibs': twoSource }, scopeDistanceMm: 1 })

if (process.env.SI_DDR3_BOARD) {
  const physical: CircuitJson = JSON.parse(await readFile(process.env.SI_DDR3_BOARD, 'utf8'))
  const ibisSources = Object.fromEntries(
    await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async (name) => [`models/${name}`, await readFile(join(models, name), 'utf8')])),
  )
  const circuitJson = await withDdr3Signals(physical, ibisSources, { block: 'DDR3_ADDR_CMD' })
  await stages('ddr3-addr-cmd', { circuitJson, ibisSources, scopeDistanceMm: 1 })
} else {
  console.log('DDR3 board JSON unavailable: set SI_DDR3_BOARD and local sprm552c.ibs / W631GG6MB-12.ibs to render its 24-net addr/cmd scope')
  manifest.ddr3 = 'unavailable: SI_DDR3_BOARD not supplied'
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
