import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutedPipelineSolver, RoutedStageSolver } from '../../src/pipeline'
import { RouteNetworkSolver, type RouteNetworkInput, type RoutedDeck } from '../../src/simulation'
import { routedProblem } from '../support/routed-fixture'

test('network owns real ladder node samples, complete probe evidence and the executable deck', async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const port = { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('network test must not run ngspice')
  } }
  const root = new RoutedPipelineSolver(input, port)
  root.solveUntilStage('RouteTransientSolver')
  const network = root.getSolver(RouteNetworkSolver.name)!
  const output = root.stageOutput('RouteNetworkSolver').value[0]
  assert.ok(network.iterations >= 3)
  assert.ok(output.evidence.cells)
  assert.ok(output.evidence.maximum_cell_delay_s)
  assert.ok(output.deck.includes('RBIAS'))
  assert.equal(output.probes.length, 3, 'two receivers and the existing rail monitor')
  assert.ok(network.visualize().lines!.some((line) => line.strokeColor === '#f59e0b'))
  assert.ok((output.evidence.warnings as string[]).some((warning) => warning.includes('candidate channel experiment')))
})

import { routedVisualFixture, assertRouteVisual } from '../support/routed-visual-fixture'

test('two-trace TSX route-network visual SVG snapshot', async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual(root.getSolver<RouteNetworkSolver>('RouteNetworkSolver')!.visualize(), 'simulation', 'route-network')
})

test('rejected network drawing retains physical context and shows its red reason', async () => {
  const { root } = await routedVisualFixture()
  const params = root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0]
  const rejected = new RouteNetworkSolver(params)
  // Drawing-only failure state; the real DDR render separately exercises the 1,024-cell admission gate.
  rejected.failed = true
  rejected.error = 'Route ladder requires 1835 cells; exceeds modest-memory limit of 1024'
  const drawing = rejected.visualize()
  assert.ok(drawing.texts!.some((text) => text.color === '#dc2626' && text.text.includes('1835')))
  assertRouteVisual(drawing, 'simulation', 'route-network-rejected')
})

import React from 'react'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { renderCoreSignals } from '../support/core-render'

/** Keep the actual TSX buffers while routing DATA around a bend or through two physical vias. */
function spatialRoute(children: React.ReactNode, via: boolean): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement<{ from?: string; children?: React.ReactNode }>(child)) return child
    if (child.type === 'trace' && child.props.from === '.TX0 > .Y') return <trace from=".TX0 > .Y" to=".RX0 > .A" width={.1} pcbPath={via
      ? ['.TX0 > .Y', { x: -3, y: 0 }, { x: -3, y: 0, via: true, fromLayer: 'top', toLayer: 'inner1' }, { x: 3, y: 0 }, { x: 3, y: 0, via: true, fromLayer: 'inner1', toLayer: 'top' }, '.RX0 > .A']
      : ['.TX0 > .Y', { x: -2, y: -1 }, { x: 2, y: -1 }, '.RX0 > .A']} />
    if (child.props.children === undefined) return child
    return React.cloneElement(child, {}, spatialRoute(child.props.children, via))
  })
}

for (const via of [false, true]) test(`real TSX spatial nodes retain ${via ? 'via layers and transition nodes' : 'bend positions and route order'}`, async context => {
  const input = await routedProblem(context)
  if (!input) return
  const board = TwoTraceBoard()
  input.circuitJson = await renderCoreSignals(React.cloneElement(board, { allowBlindAndBuriedVias: true }, spatialRoute(board.props.children, via)))
  const root = new RoutedPipelineSolver(input, { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('compile only')
  } })
  root.solveUntilStage('RouteTransientSolver')
  const deck = root.stageOutput('RouteNetworkSolver').value[0]
  const points = deck.spatialPoints.filter(point => point.net === 'DATA')
  assert.ok(points.length >= 3)
  assert.deepEqual([points[0].x, points[0].y], [-4, 0])
  assert.deepEqual([points.at(-1)!.x, points.at(-1)!.y], [4, 0])
  assert.equal(new Set(deck.spatialPoints.map(point => point.node)).size, deck.spatialPoints.length)
  const save = /^\.save (.+)$/m.exec(deck.deck)![1]
  assert.ok(points.every(point => save.includes(`v(${point.node})`)))
  const elements = deck.deck.split('\n').filter(line => /^[RLCVEHFX]/i.test(line))
  assert.ok(points.every(point => elements.some(line => line.split(' ').slice(1).includes(point.node))), 'never save nodes allocated only while inspecting a bend')
  if (via) {
    const vias = input.circuitJson.filter(record => record.type === 'pcb_trace').flatMap(trace => trace.route.filter(point => point.route_type === 'via'))
    assert.equal(vias.length, 2)
    for (const via of vias) {
      const contact = points.filter(point => Math.hypot(point.x - via.x, point.y - via.y) < 1e-6)
      assert.ok(contact.some(point => point.layer === 'top'), JSON.stringify(points))
      assert.ok(contact.some(point => point.layer === 'inner1'))
      assert.ok(contact.some(point => /^VT\d+r$/.test(point.node)))
    }
  } else {
    assert.ok(points.every(point => point.layer === 'top'))
    assert.ok(points.some(point => Math.abs(point.y + 1) < 1e-6))
    assert.ok(points.every((point, i) => !i || point.x >= points[i - 1].x))
    assert.ok(points.every(point => point.y >= -1 && point.y <= 0))
  }
})


import Differential from '../../examples/level1-differential/level1-differential'
import { readFile } from 'node:fs/promises'

test('real differential TSX keeps each leg distinct while joining its receiver and termination points', async context => {
  if (!process.env.IBIS_MODEL_DIR) return context.skip('Set IBIS_MODEL_DIR to local sn65hvd72.ibs')
  const root = new RoutedPipelineSolver({ circuitJson: await renderCoreSignals(<Differential />), ibisSources: { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`, 'utf8') } }, { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('compile only')
  } })
  root.solveUntilStage('RouteTransientSolver')
  const deck = root.stageOutput('RouteNetworkSolver').value[0]
  const endpoints = deck.evidence.endpoint_nodes as Record<string, string>
  const routes = deck.evidence.routes as { from: string; to: string }[]
  const starts = routes.map(route => deck.spatialPoints.find(point => point.node === endpoints[route.from])!)
  assert.notEqual(starts[0].net, starts[1].net)
  for (const [i, route] of routes.entries()) {
    assert.equal(deck.spatialPoints.find(point => point.node === endpoints[route.to])!.net, starts[i].net)
    assert.equal(deck.spatialPoints.filter(point => point.net === starts[i].net).length, 3)
  }
})
