import test from 'node:test'
import assert from 'node:assert/strict'
import { routeGraph, routePartitions, partitionNetworkInput, RouteNetworkSolver, type RouteGraph, type RoutePair, type RouteNetworkInput } from '../../src/simulation'
import { RoutedStageSolver } from '../../src/pipeline'
import type { RoutedDeck } from '../../src/simulation'
import { routedVisualFixture } from '../support/routed-visual-fixture'

/** Three routes have a strong first pair and a weak second pair; a fourth is independent. */
function graph(): RouteGraph {
  /** Explicit integrated coefficients make the omitted cross-energy bounds independently calculable. */
  const pair = (a: string, b: string, k: number): RoutePair => ({ nets: [a, b], inductive: k, capacitive: k / 2, capacitanceF: k * 1e-12, inductanceH: k * 1e-9, resistanceOhm: k, skinResistance: k * 1e-5, dielectricLossF: k * 1e-14, hard: false })
  return { nets: ['A', 'B', 'C', 'D'].map(id => ({ id, name: id, sources: [id], ports: [] })), pairs: [pair('A', 'B', .2), pair('B', 'C', .02)] }
}

test('EXACT preserves every nonzero dependency, including arbitrarily weak terms', () => {
  const input = graph()
  input.pairs[1].inductive = 1e-20
  assert.deepEqual(routePartitions(input, 'exact').map(part => part.nets), [['A', 'B', 'C'], ['D']])
  assert.ok(routePartitions(input, 'exact').every(part => part.dropped.pairs === 0))
})

test('victim windows are one-hop, use strict thresholds and report omitted quadratic cross-energy bounds', () => {
  const input = graph()
  const [a, b, c] = routePartitions(input, 'victim-window', .03, 1.5, .02)
  assert.deepEqual(a.nets, ['A', 'B'])
  assert.deepEqual(b.nets, ['A', 'B'])
  assert.deepEqual(c.nets, ['C'])
  assert.equal(a.dropped.pairs, 1)
  assert.ok(Math.abs(a.dropped.electricJ - .02e-12 * 1.5 ** 2) < 1e-29)
  assert.ok(Math.abs(a.dropped.magneticJ - .02e-9 * .02 ** 2) < 1e-29)
  assert.equal(a.dropped.resistanceW, 2 * .02 * .02 ** 2)
  assert.deepEqual(routePartitions(input, 'victim-window', .2)[0].nets, ['A'])
  assert.throws(() => routePartitions(input, 'victim-window', NaN), /Finite/)
  input.pairs[0].capacitanceF = NaN
  assert.throws(() => routePartitions(input, 'exact'), /finite nonnegative/)
})

test('binding closure preserves non-switching aggressors and shared package/termination dependencies', () => {
  const input = graph()
  input.pairs[1].hard = true
  assert.deepEqual(routePartitions(input, 'victim-window', .03)[0].nets, ['A', 'B', 'C'])
  assert.equal(routePartitions(input, 'victim-window', .03)[0].dropped.pairs, 0)
})

test('TSX network projection preserves the full deck, IBIS bindings, quiet states and spatial mesh', async () => {
  const { root } = await routedVisualFixture()
  const input = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0] as RouteNetworkInput
  const compiled = root.stageOutput('RouteNetworkSolver').value[0]
  const before = JSON.stringify(input)
  const topology = routeGraph(input, compiled)
  const [exact] = routePartitions(topology, 'exact')
  assert.equal(topology.nets.length, 2)
  assert.equal(exact.nets.length, 2)
  const projected = partitionNetworkInput(input, topology, exact)
  const solver = new RouteNetworkSolver(projected)
  solver.solve()
  assert.equal(solver.getOutput().value.deck, compiled.deck)
  assert.equal(JSON.stringify(input), before, 'pure projection never mutates completed input snapshots')
  assert.deepEqual(projected.bindings.models, input.bindings.models)
  assert.deepEqual(projected.bindings.plan.states, input.bindings.plan.states)
  const [window] = routePartitions(topology, 'victim-window', 1)
  const reduced = partitionNetworkInput(input, topology, window)
  assert.equal(reduced.bindings.models.length, 2, 'included driver and receiver keep their real models')
  assert.equal(reduced.geometry.wires.length, input.geometry.wires.length / 2)
  assert.ok(window.dropped.electricJ > 0)
  assert.ok(reduced.extracted.slices.some(slice => JSON.parse(slice.key).coefficientProjection?.originalIndices.length === 1), 'projected coefficients identify their original field geometry and mixed boundary conditions')
  assert.equal(reduced.options.delayBound, projected.options.delayBound)
  assert.throws(() => partitionNetworkInput(input, topology, { ...exact, nets: window.nets }), /cuts/)
})
