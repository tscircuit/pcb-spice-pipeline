import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedAdmissionSolver, RoutedBlockSolver, RoutedPipelineSolver } from '../../src/pipeline'
import { sha256 } from '../../src/kernel'
import { BasePipelineSolver } from '@tscircuit/solver-utils'
import { routedStages } from '../../src/pipeline'
import { routedProblem } from '../support/routed-fixture'
import { renderCoreSignals } from '../support/core-render'

test(
  'TSX two-trace routed compiler deck oracle before stage migration',
  { skip: !process.env.IBIS_MODEL_DIR && 'Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed' },
  async () => {
    const circuit = await renderCoreSignals(<TwoTraceBoard />)
    const bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
    assert.equal(sha256(bytes), '03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00', 'oracle uses the same vendor revision')
    const admission = new RoutedAdmissionSolver({ circuitJson: circuit, ibisSources: { 'models/sn74lvc1g04.ibs': bytes.toString('utf8') }, scopeDistanceMm: 1 })
    admission.solve()
    const plan = structuredClone(admission.getOutput().value[0])
    plan.bindings.options = { riseSeconds: 1e-9, refinement: 1, durationSeconds: 4e-9, stepSeconds: 1e-11 }
    const solver = new RoutedBlockSolver(plan)
    solver.solve()
    const result = solver.getOutput().value.compiled
    assert.equal(result.evidence.geometry_wires, 2)
    assert.equal(result.evidence.sections, 1)
    // JavaScriptCore and V8 round field arithmetic differently; both pre-visual baselines are pinned.
    const expected = process.versions.bun
      ? 'b2beb1b53a6c72ab24facbad9201e18cbcf14af93dcc9387230d42776fe52be4'
      : 'bc639ab7abfe945e62fcd6689c8ab6d63e7f4536c93ecdce12e7654f8805e6d5'
    assert.equal(Buffer.byteLength(result.deck), 23002)
    assert.equal(sha256(result.deck), expected, 'full deck bytes, including native vendor compilation and coupling')
  },
)

test('root and nested pipelines walk the single stage tuple and produce deterministic artifacts', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input)
  assert.throws(() => solver.getOutput(), /incomplete/)
  solver.solve()
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
  assert.deepEqual(
    visited,
    routedStages.map((stage) => stage.solverName),
  )
  const output = solver.getOutput()
  assert.equal(output.blocks[0].capture.kind, 'not-run')
  assert.ok(Object.keys(output.files).some((path) => path.endsWith('/simulation.cir')))
  assert.strictEqual(solver.getOutput(), output)
  const repeat = new RoutedPipelineSolver(JSON.parse(JSON.stringify(solver.getConstructorParams()[0])))
  repeat.solve()
  assert.deepEqual(repeat.getOutput(), output)
  assert.ok(solver.visualize().lines!.length > 0)
  const renamed = structuredClone(input)
  for (const record of renamed.circuitJson) {
    if (record.type === 'simulation_signal_integrity' || record.type === 'simulation_signal') record.simulation_signal_integrity_id = 'getOutput'
  }
  const collision = new RoutedPipelineSolver(renamed)
  collision.solve()
  assert.equal(collision.getOutput().blocks[0].id, 'getOutput', 'block IDs cannot overwrite debugger methods')
})

test('root with no SI blocks seals only admission and the tuple manifest', () => {
  const solver = new RoutedPipelineSolver({ circuitJson: [], ibisSources: {} })
  solver.solve()
  assert.equal(solver.getOutput().blocks.length, 0)
  assert.deepEqual(
    JSON.parse(solver.getOutput().files['stages.json']),
    routedStages.map((stage) => stage.solverName),
  )
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
