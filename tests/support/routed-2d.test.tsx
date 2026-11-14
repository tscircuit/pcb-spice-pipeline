import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCoreSignals } from './core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes, routeReferences, routeContactFrame, type CircuitJson } from '../../src/board'
import { RouteFieldsSolver, referenceSeries } from '../../src/extraction'
import { routeLadder, routeOblique, routeTransitions } from '../../src/simulation'

/** Real TSX copper, two parallel routed wires and a reference that changes across x=0. */
function Board({ overlap = false, oblique = false }: { overlap?: boolean; oblique?: boolean } = {}): React.JSX.Element {
  return <board width={16} height={12} layers={8} thickness={1.2} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled allowBlindAndBuriedVias>
    {[['A', -4, 0], ['B', 4, 0], ['C', -4, overlap ? .08 : .35], ['D', 4, overlap ? .08 : .35], ['E', 2, 0]] .map(([name, x, y]) => <chip key={name} name={String(name)} pcbX={Number(x)} pcbY={Number(y)} pinLabels={{ pin1: 'P' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" /></footprint>} />)}
    <trace from=".A > .P" to=".B > .P" width={.1} pcbPath={['.A > .P', '.B > .P']} />
    <trace from=".B > .P" to=".E > .P" width={.1} pcbPath={[".B > .P", ".E > .P"]} />
    <trace from=".C > .P" to=".D > .P" width={.1} pcbPath={['.C > .P', ...(oblique ? [{ x: 1, y: 0 }, { x: 1, y: 0, via: true as const, fromLayer: 'top' as const, toLayer: 'inner1' as const }, { x: 7, y: .95 }, { x: 7, y: .95, via: true as const, fromLayer: 'inner1' as const, toLayer: 'top' as const }] : []), '.D > .P']} />
    {overlap && <trace from=".B > .P" to=".D > .P" width={.1} pcbPath={[".B > .P", ".D > .P"]} />}
    <net name="GND" /><net name="VDDQ" />
    <copperpour name="NEAR" connectsTo="net.GND" layer="inner1" unbroken outline={[{ x: -7, y: -5 }, { x: 0, y: -5 }, { x: 0, y: oblique ? .3 : 5 }, { x: -7, y: oblique ? .3 : 5 }]} />
    <copperpour name="POWER" connectsTo="net.VDDQ" layer="inner5" unbroken outline={[{ x: -7, y: -5 }, { x: 7, y: -5 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
    <copperpour name="BEHIND" connectsTo="net.GND" layer="inner6" unbroken outline={[{ x: -7, y: -5 }, { x: 7, y: -5 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
    <copperpour name="FAR" connectsTo="net.GND" layer="inner3" unbroken outline={[{ x: -7, y: -5 }, { x: 7, y: -5 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
  </board>
}

/** Direct via-in-pad access has no nonzero planar wire on either pad's top layer. */
function ViaPadBoard(): React.JSX.Element {
  return <board width={12} height={8} layers={8} thickness={1.2} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled allowBlindAndBuriedVias>
    <chip name="VIA_PAD" pinLabels={{ pin1: 'A', pin2: 'B' }} footprint={<footprint>
      <smtpad portHints={['pin1']} pcbX={-3} pcbY={0} width={.3} height={.3} shape="rect" />
      <smtpad portHints={['pin2']} pcbX={3} pcbY={0} width={.3} height={.3} shape="rect" />
    </footprint>} />
    <trace from=".VIA_PAD > .A" to=".VIA_PAD > .B" width={.1} pcbPath={['.VIA_PAD > .A', { x: -3, y: 0 }, { x: -3, y: 0, via: true, fromLayer: 'top', toLayer: 'inner2' }, { x: 3, y: 0 }, { x: 3, y: 0, via: true, fromLayer: 'inner2', toLayer: 'top' }, '.VIA_PAD > .B']} />
    <net name="GND" /><copperpour connectsTo="net.GND" layer="inner3" unbroken />
  </board>
}

test('TSX routed 2D preserves nearby conductors, changes actual reference and caches repeated geometry', async () => {
  const circuit = await renderCoreSignals(<Board />)
  const component = circuit.filter(record => record.type === 'source_component').find(record => record.name === 'A')!
  const port = circuit.filter(record => record.type === 'source_port').find(record => record.source_component_id === component.source_component_id)!
  const groundNet = circuit.filter(record => record.type === 'source_net').find(record => record.name === 'GND')!
  const ground = connectedSourceIds(circuit, groundNet.source_net_id)
  const scope = channelCopperScope(circuit, connectedSourceIds(circuit, port.source_port_id), ground)
  const geometry = segmentRoutes(circuit, scope)
  assert.equal(scope.pcbTraceIds.length, 3)
  assert.ok(geometry.slices.some(slice => slice.wires.length === 2))
  assert.deepEqual(new Set(geometry.slices.flatMap(slice => slice.references.map(ref => ref.layer))), new Set(['inner1', 'inner3']))
  const inner4 = { ...geometry.wires[0], layer: 'inner4' }
  assert.deepEqual(routeReferences(geometry, inner4, -2).map(plane => plane.layer), ['inner5', 'inner3'], 'inner5 power copper intervenes before inner6 GND')
  const extracted = ((solver: RouteFieldsSolver) => {
    solver.solve()
    return solver.getOutput().value
  }) (new RouteFieldsSolver({ geometry: geometry, materials: { maskMm: .02, maskEr: 3.3, maskLoss: .025, substrateLoss: .02 }, artifactPrefix: 'test', panels: 12 }))
  assert.ok(extracted.sections.length <= geometry.slices.length)
  const pair = extracted.slices.find(slice => slice.wires.length === 2)!.line
  const referenced = referenceSeries(pair, [1])
  assert.ok(referenced.L[0][0] < pair.L[0][0], 'shorted AC reference induces a return current instead of an open conductor')
  assert.ok(Math.abs(referenced.L[0][0] * pair.C0[0][0] / (1.25663706212e-6 * 8.8541878128e-12) - 1) < 1e-6, 'shorted series inductance matches the independent fixed-potential C0 relationship')
  const ladder = routeLadder(extracted, (wire, point) => `n${wire.id}_${point[0]}_${point[1]}`.replace(/[-.]/g, '_'), 230e-12)
  assert.ok(ladder.maximumDelaySeconds <= 23e-12)
  assert.ok(ladder.lines.some(line => line.startsWith('K')))
  assert.ok(ladder.lines.some(line => line.startsWith('RARCG')), 'dielectric loss uses causal series-RC relaxation branches')
  const coarse = routeLadder(extracted, (wire, point) => `n${wire.id}_${point[0]}_${point[1]}`.replace(/[-.]/g, '_'), 230e-12, 1, 2)
  assert.ok(coarse.cells <= ladder.cells)
  assert.ok(coarse.maximumDelaySeconds <= 115e-12)
  assert.throws(() => routeLadder(extracted, () => '0', 230e-12, 1, 0), /Cells per rise/)
  const mergedCircuit = await renderCoreSignals(<Board overlap />)
  const merged = segmentRoutes(mergedCircuit, channelCopperScope(mergedCircuit, connectedSourceIds(mergedCircuit, port.source_port_id), ground))
  assert.ok(merged.wires.some(wire => wire.joins?.length), 'same-net overlapping bend bodies become equipotential breakout patches')
  assert.doesNotThrow(() => ((solver: RouteFieldsSolver) => {
    solver.solve()
    return solver.getOutput().value
  }) (new RouteFieldsSolver({ geometry: merged, materials: { maskMm: .02, maskEr: 3.3, maskLoss: .025, substrateLoss: .02 }, artifactPrefix: 'test' })))
  const obliqueCircuit = await renderCoreSignals(<Board oblique />)
  const obliqueScope = channelCopperScope(obliqueCircuit, connectedSourceIds(obliqueCircuit, port.source_port_id), ground)
  const obliqueGeometry = segmentRoutes(obliqueCircuit, obliqueScope)
  const materials = { maskMm: .02, maskEr: 3.3, maskLoss: .025, substrateLoss: .02 }
  const obliqueFields = ((solver: RouteFieldsSolver) => {
    solver.solve()
    return solver.getOutput().value
  }) (new RouteFieldsSolver({ geometry: obliqueGeometry, materials: materials, artifactPrefix: 'test' }))
  const obliqueLadder = routeLadder(obliqueFields, (wire, point) => `n${wire.id}_${point[0]}_${point[1]}`.replace(/[-.]/g, '_'), 230e-12)
  const encounters = routeOblique(obliqueGeometry, obliqueFields, obliqueLadder, obliqueScope, materials)
  assert.ok(encounters.records.some(record => String(record.policy).includes('intervening local reference')), 'neighbour on the local plane height uses recorded shielding instead of an invalid solver rectangle')
  const transitions = routeTransitions(obliqueCircuit, obliqueScope, obliqueGeometry, (wire, point) => `n${wire.id}_${point.join('_')}`.replace(/[-.]/g, '_'), groundNet.source_net_id)
  assert.ok(transitions.records.some(record => record.kind === 'via' && (record.padCapacitanceF as number[]).some(value => value > 0)), 'connected annular via pads add explicit capacitance')
  const viaCircuit = await renderCoreSignals(<ViaPadBoard />).catch((error: Error & { circuitJson: CircuitJson }) => {
    assert.deepEqual(error.circuitJson.filter(record => record.type.endsWith('_error')).map(record => record.type), ['pcb_placement_error', 'pcb_placement_error'], 'expected core via-in-pad placement diagnostics only')
    return error.circuitJson
  })
  const viaSource = viaCircuit.find(record => record.type === 'source_trace')! as Extract<typeof viaCircuit[number], { type: 'source_trace' }>
  const viaScope = channelCopperScope(viaCircuit, connectedSourceIds(viaCircuit, viaSource.connected_source_port_ids[0]), ground)
  const viaGeometry = segmentRoutes(viaCircuit, viaScope)
  assert.ok(viaGeometry.wires.every(wire => wire.layer === 'inner2'))
  assert.ok(routeContactFrame(viaGeometry, viaScope, 'top', [-3, 0]))
  assert.equal(viaGeometry.viaContacts.filter(contact => contact.layer === 'top').length, 2, 'via-in-pad contacts survive zero-length top wires')
  const viaTransitions = routeTransitions(viaCircuit, viaScope, viaGeometry, (wire, point) => `${wire.layer}_${point.join('_')}`.replace(/[-.]/g, '_'), 'source_net_0')
  assert.equal(viaTransitions.records.filter(record => record.kind === 'pad').length, 2, 'BGA/SMD pad C remains attached through via-only contacts')
  assert.throws(() => routeLadder(extracted, () => '0', 0), /rise time/)
})
