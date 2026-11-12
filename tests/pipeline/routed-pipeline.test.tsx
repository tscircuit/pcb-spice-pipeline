import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedPipelineSolver, RoutedStageSolver } from '../../src/pipeline'
import { formatSpiceVectors } from '../../src/observation'
import type { SolverContext } from '../../src/solver'
import { getBounds, computeTransformFromViewbox } from 'graphics-debug'
import type { StageDrawing } from '../../src/board'
import { edgeBoard, assertDrawable } from '../support/edge-boards'
import { fullBoardDdr3 } from '../support/full-board-ddr3'
import { RouteBindingsSolver, RouteNetworkSolver, type RouteBindingsInput, type RouteNetworkInput, type RoutedBindings, type RoutedDeck } from '../../src/simulation'
import { sha256 } from '../../src/kernel'
import { BasePipelineSolver } from '@tscircuit/solver-utils'
import { routedStages } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import { renderCoreSignals } from '../support/core-render'
import Differential from '../../examples/level1-differential/level1-differential'
import type { GraphicsObject } from 'graphics-debug'

test('TSX two-trace routed deck deliberately changes to declarative transient vectors', { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed' }, async () => {
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
  const expected = process.versions.bun ? '4419db05deeaad89a957f518bb9334987543fb33e89ead228ef7c954e4ebbbd2' : 'c63a3b089f0d51c211a7792cdeed9af6700f91643b081ff78f1458ee60631cb9'
  assert.equal(Buffer.byteLength(result.deck), 22205)
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


test('every completed stage retains its own final drawing, and its labels read at its own focus', async () => {
  const { root } = await routedVisualFixture()
  const drawing = root.visualize()
  assert.deepEqual(drawing, root.getSolver('RouteTransientSolver')!.visualize())
  for (const [index, definition] of root.pipelineDef.entries()) {
    const graphics: StageDrawing = root.getSolver(definition.solverName)!.visualize()
    assert.ok(graphics.texts!.some(text => text.text.startsWith(`${index + 1} ·`)))
    const transform = computeTransformFromViewbox(graphics.focus!, 1080, 620, { padding: 16, yFlip: true })
    const labels = graphics.texts!.filter(text => text.color !== '#a8a29e')
    assert.ok(labels.every(text => text.fontSize! * transform.a >= 12), `${definition.solverName}: every stage label is readable at the default camera`)
    assert.ok(labels.length <= 16, `${definition.solverName}: low text (${labels.length} labels)`)
  }
})

/** Every frame of a pipeline (stage 0 through 6) draws something finite. */
function assertStages(solver: RoutedPipelineSolver, name: string): void {
  for (const number of [0, 1, 2, 3, 4, 5, 6]) assertDrawable(solver.visualizeStage(number), `${name}: stage ${number}`)
}

test('arbitrary boards draw every stage without throwing, including when nothing is admitted', () => {
  for (const [name, circuit] of [
    ['1 layer', edgeBoard({ layers: 1 })],
    ['6 layers', edgeBoard({ layers: 6 })],
    ['outline', edgeBoard({ outline: true })],
    ['no pours or parts', edgeBoard({ pours: false, parts: false })],
    ['widthless', edgeBoard({ widthless: true })],
  ] as const) {
    const solver = new RoutedPipelineSolver({ circuitJson: circuit, ibisSources: {} }, synthetic)
    assertStages(solver, `${name} before solving`)
    try {
      solver.solve()
    } catch {
      // Admission may reject a synthetic board; the frames must still draw.
    }
    assertStages(solver, name)
  }
})

test('a real board with zero admitted blocks shows the whole board and says so on every stage', async () => {
  const { root } = await routedVisualFixture()
  const circuitJson = root.inputProblem.circuitJson.filter(record => !record.type.startsWith('simulation_'))
  const empty = new RoutedPipelineSolver({ circuitJson, ibisSources: {} }, synthetic)
  empty.solve()
  assert.equal(empty.getOutput().blocks.length, 0)
  assertStages(empty, 'zero admitted')
  for (const number of [1, 2, 3, 4, 5, 6]) assert.ok(empty.visualizeStage(number).texts!.some(text => text.text === 'No signal-integrity blocks admitted'), `stage ${number}`)
})

for (const [name, until, load, models] of [
  ['level1-single-ended', 'RouteTransientSolver', () => import('../../examples/level1-single-ended/level1-single-ended'), ['sn74lvc1g04.ibs']],
  ['level1-differential', 'RouteTransientSolver', () => import('../../examples/level1-differential/level1-differential'), ['sn65hvd72.ibs']],
  ['level2-two-channels', 'RouteTransientSolver', () => import('../../examples/level2-two-channels/level2-two-channels'), ['sn74lvc1g04.ibs']],
  ['level3-three-channels', 'RouteTransientSolver', () => import('../../examples/level3-three-channels/level3-three-channels'), ['sn74lvc1g04.ibs']],
  // The DDR3 field extraction takes minutes; its later stages draw as not run yet.
  ['level4-ddr3-write', 'RouteFieldsSolver', () => import('../../examples/level4-ddr3-write/level4-ddr3-write'), ['sprm552c.ibs', 'W631GG6MB-12.ibs']],
] as const)
  test(`${name}: every stage draws on the real board`, { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR for local vendor models' }, async () => {
    // Some examples rely on the automatic JSX runtime that the tscircuit CLI provides.
    Object.assign(globalThis, { React })
    const { default: Board } = await load()
    const ibisSources = Object.fromEntries(await Promise.all(models.map(async (model) => [`models/${model}`, await readFile(`${process.env.IBIS_MODEL_DIR}/${model}`, 'utf8')])))
    const solver = new RoutedPipelineSolver({ circuitJson: await renderCoreSignals(<Board />), ibisSources }, synthetic)
    try {
      solver.solveUntilStage(until)
    } catch {
      // A rejected stage still has to draw its frame.
    }
    assertStages(solver, name)
  })

test('full DDR3 board: stage drawings stay fast', { skip: !(process.env.SI_DDR3_BOARD && process.env.IBIS_MODEL_DIR) && 'Set SI_DDR3_BOARD and IBIS_MODEL_DIR' }, async () => {
  const circuitJson = await fullBoardDdr3(process.env.SI_DDR3_BOARD!, { block: 'DDR3_ADDR_CMD' })
  const ibisSources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async (model) => [`models/${model}`, await readFile(`${process.env.IBIS_MODEL_DIR}/${model}`, 'utf8')])))
  const solver = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, synthetic)
  solver.solveUntilStage('RouteSectionsSolver')
  let started = performance.now()
  assertStages(solver, 'ddr3')
  const first = performance.now() - started
  started = performance.now()
  for (let i = 0; i < 5; i++) solver.visualizeStage(1)
  const cached = (performance.now() - started) / 5
  console.log(`ddr3 visualize: first pass over 7 stages ${first.toFixed(0)} ms, cached stage 1 ${cached.toFixed(1)} ms`)
  assert.ok(cached < 250, `cached visualize ${cached} ms`)
})

test('default two-trace TSX deck retains the measured driver lead-in and captures its complete rise', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  solver.solveUntilStage('RouteTransientSolver')
  assert.equal(solver.stageOutput('RoutedAdmissionSolver').value[0].bindings.options.durationSeconds, 40e-9)
  const deck = solver.stageOutput('RouteNetworkSolver').value[0]
  if (!process.versions.bun) assert.equal(sha256(deck.deck), '555f72a50ff66adda88251833e0d108825d8f13dbf3aa8b2f36b23e7cb77ee0a', 'default two-trace deck is byte-identical to the nested pipeline')
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
