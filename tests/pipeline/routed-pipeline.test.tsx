import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedAdmissionSolver, RoutedBlockSolver, RoutedPipelineSolver } from '../../src/pipeline'
import { formatSpiceVectors } from '../../src/observation'
import type { SolverContext } from '../../src/solver'
import { sha256 } from '../../src/kernel'
import { BasePipelineSolver } from '@tscircuit/solver-utils'
import { routedStages } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import { renderCoreSignals } from '../support/core-render'

test('TSX two-trace routed deck deliberately changes to declarative transient vectors', { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed' }, async () => {
  const circuit = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
  assert.equal(sha256(bytes), '03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00', 'oracle uses the same vendor revision')
  const admission = new RoutedAdmissionSolver({ circuitJson: circuit, ibisSources: { 'models/sn74lvc1g04.ibs': bytes.toString('utf8') }, scopeDistanceMm: 1 })
  admission.solve()
  const plan = structuredClone(admission.getOutput().value[0])
  plan.bindings.options = { riseSeconds: 1e-9, refinement: 1, durationSeconds: 4e-9, stepSeconds: 1e-11 }
  const solver = new RoutedBlockSolver({ ...plan, context: synthetic })
  solver.solveUntilStage('RouteTransientSolver')
  const result = solver.getStageOutput<{ value: import('../../src/simulation').RoutedDeck }>('RouteNetworkSolver')!.value
  assert.equal(result.evidence.geometry_wires, 2)
  assert.equal(result.evidence.sections, 1)
  assert.equal(sha256(result.deck), 'c63a3b089f0d51c211a7792cdeed9af6700f91643b081ff78f1458ee60631cb9', 'full deck bytes, including native vendor compilation and coupling')
})


/** Synthetic engine protocol only; native evidence lives in route-transient.test.tsx. */
const synthetic: SolverContext = { progress: (): void => undefined, runSolver: async request => {
  const deck = request.files['simulation.cir']
  const duration = Number(/^\.tran\s+\S+\s+(\S+)/m.exec(deck)![1])
  const names = [...new Set([...deck.matchAll(/v\(([^)]+)\)/g)].map(match => match[1]))]
  return { stdout: '', stderr: '', files: { 'waveform.raw': formatSpiceVectors([{ name: 'time', type: 'time', values: [0, duration] }, ...names.map(name => ({ name: `v(${name})`, type: 'voltage', values: [0, 0] }))]) } }
} }

test('root and nested pipelines walk the single stage tuple and produce deterministic artifacts', async context => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  assert.throws(() => solver.getOutput(), /incomplete/)
  await solver.solveAsync()
  const visited: string[] = []
  /** Discover actual nested debugger stages, without maintaining another stage list. */
  function visit(pipeline: BasePipelineSolver<unknown>): void {
    for (const stage of pipeline.pipelineDef) {
      const child = pipeline.getSolver(stage.solverName)!
      assert.equal(child.solved, true)
      if (child instanceof BasePipelineSolver) visit(child)
      else {
        visited.push(stage.solverName)
        assert.ok(Object.keys(child.stats).length > 0)
        assert.ok(JSON.stringify(child.visualize()).length > 30)
      }
    }
  }
  visit(solver)
  assert.deepEqual(visited, routedStages.map(stage => stage.solverName))
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
  assertRouteVisual(root.initialVisualize(), 'pipeline', 'routed-pipeline-initial')
  assertRouteVisual(root.finalVisualize(), 'pipeline', 'routed-pipeline-final')
})


test('completed root atlas has one board heading and retains cross-section foreground lines', async () => {
  const { root, block } = await routedVisualFixture()
  const drawing = root.visualize()
  assert.deepEqual(drawing, block.visualize())
  assert.equal(drawing.texts!.filter(text => text.text.includes('Board plan')).length, 1)
  assert.ok(drawing.polygons!.some(polygon => polygon.stroke === '#9333ea'))
  assert.ok(drawing.texts!.some(text => text.text.includes('native not run')))
  assertRouteVisual(drawing, 'pipeline', 'routed-pipeline-atlas')
})
