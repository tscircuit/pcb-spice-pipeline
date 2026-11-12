import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedPipelineSolver, RoutedStageSolver } from '../../src/pipeline'
import { formatSpiceVectors } from '../../src/observation'
import type { SolverContext } from '../../src/solver'
import { getBounds, computeTransformFromViewbox } from 'graphics-debug'
import { routeTextSize } from '../../src/board'
import { RouteBindingsSolver, RouteNetworkSolver, type RouteBindingsInput, type RouteNetworkInput, type RoutedBindings, type RoutedDeck } from '../../src/simulation'
import { sha256 } from '../../src/kernel'
import { BasePipelineSolver } from '@tscircuit/solver-utils'
import { routedStages } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import { renderCoreSignals } from '../support/core-render'
import Differential from '../../examples/level1-differential/level1-differential'
import type { GraphicsObject } from 'graphics-debug'

test('TSX two-trace routed deck pins normalized reciprocal resistance and declarative transient vectors', { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed' }, async () => {
  const circuit = await renderCoreSignals(<TwoTraceBoard bit-rate="400Mbps" duration-seconds={4e-9} />)
  const bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
  assert.equal(sha256(bytes), '03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00', 'oracle uses the same vendor revision')
  const solver = new RoutedPipelineSolver({ circuitJson: circuit, ibisSources: { 'models/sn74lvc1g04.ibs': bytes.toString('utf8') }, scopeDistanceMm: 1 }, synthetic)
  solver.solveUntilStage('RouteTransientSolver')
  const options = { riseSeconds: 1e-9, refinement: 1, durationSeconds: 4e-9, stepSeconds: 1e-11 }
  const input = solver.getSolver<RoutedStageSolver<RouteBindingsInput, RoutedBindings>>('RouteBindingsSolver')!.getConstructorParams()[0][0]
  const bindings = new RouteBindingsSolver({ ...input, options })
  bindings.solve()
  const networkInput = solver.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0]
  const network = new RouteNetworkSolver({ ...networkInput, bindings: bindings.getOutput().value, options })
  network.solve()
  const result = network.getOutput().value
  assert.equal(result.evidence.geometry_wires, 2)
  assert.equal(result.evidence.sections, 1)
  // V8 and JavaScriptCore differ in the final digits of the unchanged BEM coefficients.
  const expected = process.versions.bun ? '16f6dfd29ce75f707b7c57dbfd510a79a92514197ff26d186ebee2ff1d20cd2e' : '4449495ed906e508d7a30907fce804d3f9dc60d90984379f5550edcd845f7bc5'
  assert.equal(Buffer.byteLength(result.deck), 22944)
  assert.equal(sha256(result.deck), expected, 'full deck bytes, including vendor compilation and coupling, pinned per JS engine')
})


/** Synthetic engine protocol only; native evidence lives in route-transient.test.tsx. */
const synthetic: SolverContext = { progress: (): void => undefined, runSolver: async request => {
  const deck = request.files['simulation.cir']
  const duration = Number(/^\.tran\s+\S+\s+(\S+)/m.exec(deck)![1])
  const names = [...new Set([...deck.matchAll(/v\(([^)]+)\)/g)].map(match => match[1]))]
  return { stdout: '', stderr: '', files: { 'waveform.raw': formatSpiceVectors([{ name: 'time', type: 'time', values: [0, duration] }, ...names.map(name => ({ name: `v(${name})`, type: 'voltage', values: [0, 0] }))]) } }
} }

test('six static stages walk all blocks without nested pipelines and produce deterministic artifacts', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  assert.throws(() => solver.getOutput(), /incomplete/)
  await solver.solveAsync()
  assert.deepEqual(solver.pipelineDef, routedStages)
  for (const stage of solver.pipelineDef) {
    const child = solver.getSolver(stage.solverName)!
    assert.equal(child.solved, true)
    assert.equal(child instanceof BasePipelineSolver, false, 'domain stages never create nested pipeline rows')
    assert.equal(child.activeSubSolver, undefined)
    assert.ok(Object.keys(child.stats).length > 0)
    assert.ok(JSON.stringify(child.visualize()).length > 30)
  }
  const output = solver.getOutput()
  assert.equal(output.blocks[0].capture.kind, 'completed')
  assert.ok(Object.keys(output.files).some(path => path.endsWith('/simulation.cir')))
  assert.strictEqual(solver.getOutput(), output)
  const repeat = new RoutedPipelineSolver(JSON.parse(JSON.stringify(solver.getConstructorParams()[0])), synthetic)
  await repeat.solveAsync()
  assert.deepEqual(repeat.getOutput(), output)
  assert.ok(solver.visualize().lines!.length > 0)
  const renamed = structuredClone(input)
  for (const record of renamed.circuitJson) {
    if (record.type === 'simulation_signal_integrity' || record.type === 'simulation_signal') record.simulation_signal_integrity_id = 'getOutput'
  }
  const collision = new RoutedPipelineSolver(renamed, synthetic)
  await collision.solveAsync()
  assert.equal(collision.getOutput().blocks[0].id, 'getOutput', 'block IDs cannot overwrite debugger methods')
})

test('root with no SI blocks seals only admission and the tuple manifest', () => {
  const solver = new RoutedPipelineSolver({ circuitJson: [], ibisSources: {} }, synthetic)
  solver.solve()
  assert.equal(solver.getOutput().blocks.length, 0)
  assert.deepEqual(JSON.parse(solver.getOutput().files['stages.json']), routedStages.map(stage => stage.solverName))
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('two-trace TSX root initial and final visual SVG snapshots', async () => {
  const { root } = await routedVisualFixture()
  const initial = new RoutedPipelineSolver(root.inputProblem, synthetic)
  assertRouteVisual(initial.initialVisualize(), 'pipeline', 'routed-pipeline-initial')
  assertRouteVisual(root.finalVisualize(), 'pipeline', 'routed-pipeline-final')
})


test('every completed stage retains its own final drawing and shared readable typography', async () => {
  const { root } = await routedVisualFixture()
  const drawing = root.visualize()
  assert.deepEqual(drawing, root.getSolver('RouteTransientSolver')!.visualize())
  for (const [index, definition] of root.pipelineDef.entries()) {
    const stage = root.getSolver(definition.solverName)!
    const graphics = stage.visualize()
    assert.ok(graphics.texts!.some(text => text.text.startsWith(`${index + 1} ·`)))
    assert.ok(graphics.texts!.every(text => text.fontSize === routeTextSize.body || text.fontSize === routeTextSize.title))
    const bounds = getBounds(graphics)
    const transform = computeTransformFromViewbox(bounds, 1080, 620, { padding: 16, yFlip: true })
    assert.ok(graphics.texts!.every(text => text.fontSize! * transform.a >= 12), 'a full-size stage keeps every caption readable')
  }
})


test('default two-trace TSX deck retains the measured driver lead-in and captures its complete rise', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  solver.solveUntilStage('RouteTransientSolver')
  assert.equal(solver.stageOutput('RoutedAdmissionSolver').value[0].bindings.options.durationSeconds, 40e-9)
  const deck = solver.stageOutput('RouteNetworkSolver').value[0]
  if (!process.versions.bun) assert.equal(sha256(deck.deck), '1dd9620fc7beba0ba6151d618151823f51e7d78bfcd16dadf4350af15e582eb8', 'default two-trace deck pins the deliberate normalized resistance realization')
  const values = /^VKU0 .*PWL\((.+)\)$/m.exec(deck.deck)![1].split(/\s+/).map(Number)
  const weights = values.filter((_, i) => i % 2 === 0).map((time, i) => [time, values[2 * i + 1]])
  // The old 2.5 ns trigger plus preserved lead-in fell outside its 4 ns capture.
  assert.ok(weights.some(([time, ku]) => time > 20e-9 && time < 22e-9 && Math.abs(ku) < .01))
  assert.ok(weights.some(([time, ku]) => time > 23e-9 && time < 26e-9 && ku > .9))
  assert.ok(weights.at(-1)![1] > .9)
})


test('all six static stage definitions exist before the first step', () => {
  const root = new RoutedPipelineSolver({ circuitJson: [], ibisSources: {} }, synthetic)
  const definitions = [...root.pipelineDef]
  assert.equal(definitions.length, 6)
  for (const stage of definitions) assert.equal(root.getSolver(stage.solverName), undefined)
  root.step()
  assert.deepEqual(root.pipelineDef, definitions, 'admission never creates stage definitions at runtime')
})


test('actual two-block TSX advances every flat stage and invokes transients sequentially', async () => {
  const { root: fixture } = await routedVisualFixture(2)
  let active = 0
  let calls = 0
  const root = new RoutedPipelineSolver(fixture.inputProblem, {
    progress: (): void => undefined,
    runSolver: async request => {
      calls++
      assert.equal(++active, 1, 'at most one transient can be in flight')
      await new Promise<void>(resolve => setImmediate(resolve))
      const result = await synthetic.runSolver(request)
      active--
      return result
    },
  })
  root.solveUntilStage('RouteBindingsSolver')
  assert.equal(root.stageOutput('RoutedAdmissionSolver').value.length, 2)
  assert.equal(root.stageOutput('RouteSectionsSolver').value.length, 2)
  assert.equal(root.stageOutput('RouteFieldsSolver').value.length, 2)
  const sections = root.getSolver('RouteSectionsSolver')!.visualize()
  assertRouteVisual(root.visualizeStage(3), 'pipeline', 'routed-pipeline-fields')
  assert.ok(root.visualize().texts!.some(text => text.text.startsWith('4 ·')), 'stage boundaries draw the incoming bindings input')
  await root.solveAsync()
  assert.equal(calls, 2)
  assert.equal(root.getOutput().blocks.length, 2)
  assert.deepEqual(root.getSolver('RouteSectionsSolver')!.visualize(), sections, 'later stages preserve the final Sections drawing')
  assert.equal(root.getSolver('RouteTransientSolver')!.stats.invocations, 2)
  for (const stage of root.pipelineDef.slice(1)) {
    const child = root.getSolver(stage.solverName)!
    assert.equal(child.stats.completedBlocks, 2)
    assert.ok(child.iterations >= 2)
    assert.ok(root.timeSpentOnStage[stage.solverName] >= 0)
  }
})


/** Every frame must carry real geometry and a finite, nondegenerate fit, including async waits. */
function assertDrawing(drawing: GraphicsObject, state: string): void {
  const count = ['points', 'lines', 'rects', 'circles', 'texts'].reduce(
    (sum, key) => sum + ((drawing[key as keyof GraphicsObject] as unknown[] | undefined)?.length ?? 0),
    0,
  )
  assert.ok(count > 0, `${state}: no drawable objects`)
  assert.ok((drawing.lines?.length ?? 0) + (drawing.rects?.length ?? 0) > 0, `${state}: draw physical input or output, not only a heading`)
  const bounds = getBounds(drawing)
  assert.ok(Object.values(bounds).every(Number.isFinite), `${state}: nonfinite bounds ${JSON.stringify(bounds)}`)
  assert.ok(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY, `${state}: degenerate bounds`)
}

for (const name of ['two-trace', 'level1-differential'])
  test(`${name}: every iteration, stage boundary and pending transient has a physical drawing`, async (context) => {
    let input
    if (name === 'two-trace') input = (await routedVisualFixture()).root.inputProblem
    else {
      if (!process.env.IBIS_MODEL_DIR) return context.skip('Set IBIS_MODEL_DIR for the local differential vendor model')
      input = {
        circuitJson: await renderCoreSignals(<Differential />),
        ibisSources: { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`, 'utf8') },
      }
    }
    let calls = 0
    const solver = new RoutedPipelineSolver(input, {
      progress: (): void => undefined,
      runSolver: async (request) => {
        calls++
        const drawing = solver.visualize()
        assertDrawing(drawing, `${name}: ngspice pending`)
        assert.ok(drawing.texts!.some((text) => text.text.includes('running ngspice')))
        await new Promise<void>((resolve) => setImmediate(resolve))
        return synthetic.runSolver(request)
      },
    })
    assertDrawing(solver.visualize(), `${name}: initial`)
    while (!solver.solved && !solver.failed) {
      assert.ok(solver.iterations < 200, 'bounded iteration check')
      const pending = solver.stepAsync()
      assertDrawing(solver.visualize(), `${name}: iteration ${solver.iterations} pending`)
      await pending
      assertDrawing(solver.visualize(), `${name}: iteration ${solver.iterations}`)
      const number = Math.min(solver.currentPipelineStageIndex + 1, 6)
      assert.ok(
        solver.visualize().texts!.some((text) => text.text.startsWith(`${number} ·`)),
        `${name}: incoming stage ${number} input must be drawn`,
      )
    }
    assert.equal(solver.failed, false)
    assert.equal(calls, 1)
    for (const number of [1, 2, 3, 4, 5, 6]) assertDrawing(solver.visualizeStage(number), `${name}: retained ${number}`)
  })
