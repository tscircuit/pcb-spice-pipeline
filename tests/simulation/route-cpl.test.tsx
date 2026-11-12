import test from 'node:test'
import assert from 'node:assert/strict'
import { routedCopper } from '../support/routed-fixture'
import { routePosition, segmentRoutes, type RouteWire, type RouteXY } from '../../src/board'
import { RouteFieldsSolver } from '../../src/extraction'
import { routeCplSteps, compileRouteCpl } from '../../src/simulation/route-cpl'
import type { RouteNetworkInput, RoutedDeck } from '../../src/simulation'
import type { RoutedStageSolver } from '../../src/pipeline'
import { routedVisualFixture } from '../support/routed-visual-fixture'

/** Test names follow real TSX copper positions, including section boundaries. */
const endpoint = (wire: RouteWire, point: RouteXY): string => `${wire.layer}_${point.map(value => value.toFixed(8)).join('_')}`

test('real two-trace TSX emits packed Maxwell CPL and chains a nonuniform boundary', async () => {
  const { circuitJson, scope } = await routedCopper()
  const fields = new RouteFieldsSolver({ geometry: segmentRoutes(circuitJson, scope), artifactPrefix: 'test' })
  fields.solve()
  const extracted = fields.getOutput().value
  const slice = extracted.slices.find(slice => slice.wires.length === 2)!
  assert.ok(slice)
  const middle = (slice.start + slice.end) / 2
  const steps = routeCplSteps({ ...extracted, slices: [{ ...slice, end: middle }, { ...slice, start: middle }] }, endpoint, 1e-9)
  let result = steps.next()
  while (!result.done) result = steps.next()
  const models = result.value.lines.filter(line => line.startsWith('P'))
  assert.equal(models.length, 2)
  for (const wire of slice.wires) assert.ok(models.every(model => model.includes(endpoint(wire, routePosition(wire, middle)))))
  assert.match(result.value.lines.find(line => line.startsWith('+ C='))!, /-[\d.]+e-/)
  assert.equal(result.value.lines.find(line => line.startsWith('+ R='))!.slice(4).split(' ').length, 3)
  assert.equal(result.value.lines.some(line => line.startsWith('K')), false)
  assert.ok(result.value.warnings!.some(warning => warning.includes('omits skin')))
  const invalid = routeCplSteps({ ...extracted, slices: [{ ...slice, wires: Array(9).fill(slice.wires[0]) }] }, endpoint, 1e-9)
  assert.throws(() => invalid.next(), /at most 8/)
  const reduced = routeCplSteps({ ...extracted, slices: [slice] }, (wire, point) => wire.id === slice.wires[1].id ? '0' : endpoint(wire, point), 1e-9)
  let rail = reduced.next()
  while (!rail.done) rail = reduced.next()
  assert.equal(rail.value.cells, 1)
  const model = rail.value.lines.find(line => line.startsWith('.model'))!
  assert.match(model, /LTRA R=\S+ L=\S+ G=0 C=\S+ LEN=/)
  const inductance = Number(/ L=(\S+)/.exec(model)![1])
  const expected = slice.line.L[0][0] - slice.line.L[0][1] ** 2 / slice.line.L[1][1]
  assert.ok(Math.abs(inductance / expected - 1) < 1e-10, 'grounded rail current reduces the series energy')
})

test('alternate compiler retains actual IBIS, probes and lumped transitions without changing default deck', async () => {
  const { root } = await routedVisualFixture()
  const network = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!
  const input = network.getConstructorParams()[0][0]
  const original = root.stageOutput('RouteNetworkSolver').value[0]
  const compiled = compileRouteCpl(input).value
  assert.deepEqual(compiled.probes, original.probes)
  assert.deepEqual(compiled.evidence.transitions, original.evidence.transitions)
  assert.match(compiled.deck, /\.model ROUTECPL\d+ CPL/)
  assert.match(compiled.deck, /XIBIS0/)
  assert.ok(compiled.deck.length < original.deck.length)
  assert.match(String(compiled.evidence.line_model), /G=0/)
  assert.equal(root.stageOutput('RouteNetworkSolver').value[0].deck, original.deck)
})
