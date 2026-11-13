import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Circuit, simulation } from '@tscircuit/core'
import { RoutedPipelineSolver, RoutedStageSolver } from '../../src/pipeline'
import { boundScopeInput, routeScopeNets, RouteNetworkSolver, type RouteNetworkInput, type RoutedDeck } from '../../src/simulation'
import type { CircuitJson } from '../../src/board'
import { drawingIbis } from '../support/routed-visual-fixture'

/** One IBIS-driven route with an unmodelled copper neighbour 0.35 mm away, between plain pads. */
function NeighbourBoard(): React.JSX.Element {
  return <board width={16} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {[-4, 4].map(x => {
      const name = x < 0 ? 'TX' : 'RX'
      const pin = x < 0 ? '4' : '2'
      const label = x < 0 ? 'Y' : 'A'
      return <React.Fragment key={name}>
        <chip name={name} pcbX={x} pcbY={0} pinLabels={{ pin2: 'A', pin3: 'GND', pin4: 'Y', pin5: 'VCC' }} connections={{ GND: 'net.GND', VCC: 'net.VCC' }} footprint={<footprint>
          <smtpad portHints={[`pin${pin}`]} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" />
          <smtpad portHints={['pin3']} pcbX={0} pcbY={-2.5} width={.4} height={.4} shape="rect" />
          <smtpad portHints={['pin5']} pcbX={0} pcbY={2.5} width={.4} height={.4} shape="rect" />
        </footprint>} />
        <via name={`G_${name}`} pcbX={x} pcbY={-2.5} fromLayer="top" toLayer="bottom" holeDiameter={.15} outerDiameter={.3} connectsTo={`.${name} > .GND`} />
        <simulation.ibismodel componentRef={`.${name}`} ibisModelAsset={{ project_relative_path: 'models/sn74lvc1g04.ibs', url: './models/sn74lvc1g04.ibs', mimetype: 'text/plain' }} ibisComponentName="LVC1G04_DCK"
          ibisPinNameToPortLabel={{ [pin]: label, '3': 'GND', '5': 'VCC' }} ibisPinNameToModelName={{ [pin]: x < 0 ? 'LVC1G04_OUT_33' : 'LVC1G04_IN_33' }}
          ibisPinNameToReferencePortLabels={{ [pin]: { pullup: 'VCC', pulldown: 'GND', powerClamp: 'VCC', groundClamp: 'GND' } }} />
        <chip name={`N${name}`} pcbX={x} pcbY={.35} pinLabels={{ pin1: 'X' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" /></footprint>} />
      </React.Fragment>
    })}
    <trace from=".TX > .Y" to=".RX > .A" width={.1} pcbPath={['.TX > .Y', '.RX > .A']} />
    <trace from=".NTX > .X" to=".NRX > .X" width={.1} pcbPath={['.NTX > .X', '.NRX > .X']} />
    <net name="GND" /><net name="VCC" />
    <copperpour name="POWER" connectsTo="net.VCC" layer="top" unbroken outline={[{ x: -7, y: 2.3 }, { x: 7, y: 2.3 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
    <copperpour name="RETURN" connectsTo="net.GND" layer="bottom" unbroken outline={[{ x: -7, y: -5 }, { x: 7, y: -5 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
    <simulation.pcbtransientchannelsimulation name="ONE" bitRate="400Mbps" duration={4e-9}>
      <simulation.pcbchannel name="DATA" driverRef=".TX > .Y" receiverRef=".RX > .A" pattern="01" />
    </simulation.pcbtransientchannelsimulation>
  </board>
}

/** Compile the TSX board through the five non-native stages. */
async function compiled(): Promise<{ input: RouteNetworkInput; deck: RoutedDeck }> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(drawingIbis) } })
  circuit.add(<NeighbourBoard />)
  await circuit.renderUntilSettled()
  const root = new RoutedPipelineSolver({ circuitJson: circuit.getCircuitJson() as CircuitJson, ibisSources: { 'models/sn74lvc1g04.ibs': drawingIbis }, scopeDistanceMm: 1 }, { progress: (): void => undefined, runSolver: async (): Promise<never> => {
    throw new Error('scope test must not run ngspice')
  } })
  root.solveUntilStage('RouteTransientSolver')
  return { input: root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>('RouteNetworkSolver')!.getConstructorParams()[0][0], deck: root.stageOutput('RouteNetworkSolver').value[0] }
}

/** Emit the deck for one scoped input. */
function deck(input: RouteNetworkInput): RoutedDeck {
  const solver = new RouteNetworkSolver(input)
  solver.solve()
  return solver.getOutput().value
}

test('TSX bound-signal scope rules drop, fold, threshold and terminate an unbound neighbour', async () => {
  const { input, deck: full } = await compiled()
  const before = JSON.stringify(input)
  const nets = routeScopeNets(input)
  assert.deepEqual(nets.map(net => net.bound), [true, false])
  const neighbour = nets[1]
  assert.ok(neighbour.coupling > .05 && neighbour.coupling < 1, `local coupling ${neighbour.coupling}`)
  assert.ok(neighbour.impedanceOhm > 30 && neighbour.impedanceOhm < 150, `Z0 ${neighbour.impedanceOhm}`)
  assert.equal(deck(boundScopeInput(input, {})).deck, full.deck, 'keeping every net without terminations is the identity')
  const drop = boundScopeInput(input, { couplingThreshold: Infinity })
  assert.ok(drop.geometry.wires.every(wire => nets[0].sources.includes(wire.source) || input.bindings.scope.nonReferenceRailTraceIds.includes(wire.trace)))
  assert.deepEqual(boundScopeInput(input, { couplingThreshold: neighbour.coupling / 2 }).geometry.wires, input.geometry.wires)
  assert.deepEqual(boundScopeInput(input, { couplingThreshold: neighbour.coupling }).geometry.wires, drop.geometry.wires, 'strict threshold')
  const fold = boundScopeInput(input, { couplingThreshold: Infinity, foldRemoved: true })
  const coupled = input.extracted.slices.findIndex(slice => slice.wires.some(wire => neighbour.sources.includes(wire.source)) && slice.wires.some(wire => nets[0].sources.includes(wire.source)))
  /** Bound-net self C in the first coupled slice, after a scope rule. */
  const self = (scoped: RouteNetworkInput): number => {
    const slice = scoped.extracted.slices.find(slice => slice.start === input.extracted.slices[coupled].start && slice.wires.some(wire => wire.id === input.extracted.slices[coupled].wires[0].id))!
    const i = slice.wires.findIndex(wire => nets[0].sources.includes(wire.source))
    return slice.line.C[i][i]
  }
  const index = input.extracted.slices[coupled].wires.findIndex(wire => nets[0].sources.includes(wire.source))
  assert.equal(self(drop), input.extracted.slices[coupled].line.C[index][index], 'dropped neighbour is AC-grounded')
  assert.ok(self(fold) < self(drop), 'a floating neighbour lowers the bound net self C')
  const dropped = deck(drop)
  assert.ok((dropped.evidence.cells as number) < (full.evidence.cells as number))
  assert.deepEqual(dropped.probes, full.probes)
  assert.ok((dropped.evidence.warnings as string[]).some(warning => warning.includes('1/2 routed nets kept')))
  const terminated = deck(boundScopeInput(input, { terminateKept: true }))
  const resistors = terminated.deck.split('\n').filter(line => line.startsWith('RZ0T'))
  assert.equal(resistors.length, 2, 'both neighbour pads are terminated')
  assert.ok(resistors.every(line => Math.abs(Number(line.split(' ')[3]) - neighbour.impedanceOhm) < 1e-3))
  assert.equal(JSON.stringify(input), before, 'scope rules never mutate completed input snapshots')
  assert.throws(() => boundScopeInput(input, { couplingThreshold: -1 }), /nonnegative/)
})
