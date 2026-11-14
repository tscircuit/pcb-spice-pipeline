import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedPipelineSolver, RoutedStageSolver } from '../../src/pipeline'
import { formatSpiceVectors } from '../../src/observation'
import type { SolverContext } from '../../src/solver'
import type { CircuitJson } from '../../src/board'
import { boardPictureView } from '../../src/board/board-picture'
import { RouteBindingsSolver, RouteNetworkSolver, type RouteBindingsInput, type RouteNetworkInput, type RoutedBindings, type RoutedDeck } from '../../src/simulation'
import { sha256 } from '../../src/kernel'
import { BasePipelineSolver } from '@tscircuit/solver-utils'
import { routedStages } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import { renderCoreSignals } from '../support/core-render'
import Differential from '../../examples/level1-differential/level1-differential'
import type { GraphicsObject } from 'graphics-debug'

test('TSX two-trace routed deck pins the single coupled skin multiport and declarative transient vectors', { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed' }, async () => {
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
  const expected = process.versions.bun ? '122d777fa136790a8e4854470db3a860e58cc950c4ef6576361773addfca317b' : '4844aa556dbd31815e8a301a83a244b3a5f59c644067fb1c0e74170faaa99403'
  assert.equal(Buffer.byteLength(result.deck), 20668)
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


test('every completed stage retains its own final drawing with few, readable labels', async () => {
  const { root } = await routedVisualFixture()
  const drawing = root.visualize()
  assert.deepEqual(drawing, root.getSolver('RouteTransientSolver')!.visualize())
  for (const definition of root.pipelineDef) {
    const graphics = root.getSolver(definition.solverName)!.visualize()
    const texts = graphics.texts ?? []
    assert.ok(texts.length <= 12, `${definition.solverName}: no titles, legends or footers`)
    const view = boardPictureView(root.inputProblem.circuitJson, graphics)
    const scale = Math.min(1000 / (view.maxX - view.minX), 540 / (view.maxY - view.minY))
    assert.ok(texts.every(text => text.fontSize! * scale >= 10), `${definition.solverName}: a 1080 x 620 picture keeps every label readable`)
  }
})


test('default two-trace TSX deck retains the measured driver lead-in and captures its complete rise', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  solver.solveUntilStage('RouteTransientSolver')
  assert.equal(solver.stageOutput('RoutedAdmissionSolver').value[0].bindings.options.durationSeconds, 40e-9)
  const deck = solver.stageOutput('RouteNetworkSolver').value[0]
  if (!process.versions.bun) assert.equal(sha256(deck.deck), 'f54828db964a2d5d7dc85318ae651f5003f89573d2dd363d792acd2851115821', 'default two-trace deck pins the deliberate single skin multiport realization')
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
  assert.ok(root.visualize().lines!.length > 0, 'stage boundaries draw the incoming bindings input')
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


/** Every frame must give the board picture a finite, nondegenerate camera, including async waits. */
function assertDrawing(circuit: CircuitJson, drawing: GraphicsObject, state: string): void {
  const view = boardPictureView(circuit, drawing)
  assert.ok(Object.values(view).every(Number.isFinite), `${state}: nonfinite camera ${JSON.stringify(view)}`)
  assert.ok(view.maxX > view.minX && view.maxY > view.minY, `${state}: degenerate camera`)
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
    const circuit: CircuitJson = input.circuitJson
    let calls = 0
    const solver: RoutedPipelineSolver = new RoutedPipelineSolver(input, {
      progress: (): void => undefined,
      runSolver: async (request) => {
        calls++
        const drawing: GraphicsObject = solver.visualize()
        assertDrawing(circuit, drawing, `${name}: ngspice pending`)
        assert.equal(drawing.lines!.filter((line) => line.layer === 'waveform').length, 0, 'no curves while ngspice runs')
        await new Promise<void>((resolve) => setImmediate(resolve))
        return synthetic.runSolver(request)
      },
    })
    assertDrawing(circuit, solver.visualize(), `${name}: initial`)
    while (!solver.solved && !solver.failed) {
      assert.ok(solver.iterations < 200, 'bounded iteration check')
      const pending = solver.stepAsync()
      assertDrawing(circuit, solver.visualize(), `${name}: iteration ${solver.iterations} pending`)
      await pending
      assertDrawing(circuit, solver.visualize(), `${name}: iteration ${solver.iterations}`)
      if (solver.getStageOutput('RoutedAdmissionSolver')) assert.ok(solver.visualize().lines!.length > 0, `${name}: once admitted, every stage draws the selected copper`)
    }
    assert.equal(solver.failed, false)
    assert.equal(calls, 1)
    for (const number of [1, 2, 3, 4, 5, 6]) assertDrawing(circuit, solver.visualizeStage(number), `${name}: retained ${number}`)
  })
