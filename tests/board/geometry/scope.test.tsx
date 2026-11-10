import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCoreSignals } from '../../support/core-render'
import { channelCopperScope, connectedSourceIds, copperScopeRejections, type CircuitJson } from '../../../src/board'

/** World-mm paths; inner-layer access barrels sit 2 mm beyond the selected endpoints. */
function Wire({ name, y, layer = 'top', extent = 8 }: { name: string; y: number; layer?: 'top' | 'inner1' | 'inner2'; extent?: number }): React.JSX.Element {
  return <>
    <chip name={name} pcbY={y} pinLabels={{ pin1: 'A', pin2: 'B' }} footprint={<footprint>
      <smtpad portHints={['pin1']} pcbX={-extent} pcbY={0} width={.3} height={.3} shape="rect" />
      <smtpad portHints={['pin2']} pcbX={extent} pcbY={0} width={.3} height={.3} shape="rect" />
    </footprint>} />
    <trace name={`${name}_route`} from={`.${name} > .A`} to={`.${name} > .B`} width={.1} pcbPath={[`.${name} > .A`, ...(layer === 'top' ? [] : [
      { x: -7, y }, { x: -7, y, via: true as const, fromLayer: 'top' as const, toLayer: layer },
      { x: 7, y }, { x: 7, y, via: true as const, fromLayer: layer, toLayer: 'top' as const },
    ]), `.${name} > .B`]} />
  </>
}

test('TSX coupling scope keeps adjacent layers, full via spans and return pours while omitting distant nets', async () => {
  const circuit = await renderCoreSignals(<board width={24} height={16} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled allowBlindAndBuriedVias>
    <chip name="PAD_ONLY" pcbY={-.8} pinLabels={{ pin1: 'A' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.3} height={.3} shape="rect" /></footprint>} />
    <chip name="OPEN_PAD" pcbX={2} pcbY={-.8} pinLabels={{ pin1: 'A' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.3} height={.3} shape="rect" /></footprint>} />
    <trace from=".PAD_ONLY > .A" to="net.FLOATING" />
    <Wire name="SELECTED" y={0} extent={5} />
    <Wire name="SAME" y={1.05} /><Wire name="FAR" y={2} extent={10} />
    <Wire name="ADJACENT" y={-.5} layer="inner1" extent={9} /><Wire name="DEEP" y={-1} layer="inner2" extent={11} />
    <copperpour name="RETURN" layer="bottom" connectsTo="net.GND" unbroken />
    <copperpour name="OTHER_PLANE" layer="inner1" connectsTo="net.OTHER" unbroken outline={[{ x: -1, y: .8 }, { x: 1, y: .8 }, { x: 1, y: 1.4 }, { x: -1, y: 1.4 }]} />
  </board>).catch((error: Error & { circuitJson: CircuitJson }) => {
    assert.deepEqual(error.circuitJson.filter(record => record.type.endsWith('_error')).map(record => record.type), ['pcb_port_not_connected_error'])
    return error.circuitJson
  })
  const selected = circuit.filter(record => record.type === 'source_trace').find(trace => trace.name === 'SELECTED_route')!
  const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
  const scope = channelCopperScope(circuit, connectedSourceIds(circuit, selected.connected_source_port_ids[0]), connectedSourceIds(circuit, ground.source_net_id))
  const retained = circuit.filter(record => record.type === 'pcb_trace').filter(trace => scope.pcbTraceIds.includes(trace.pcb_trace_id))
    .map(trace => circuit.filter(record => record.type === 'source_trace').find(source => source.source_trace_id === trace.source_trace_id)!.name!.replace('_route', ''))
  assert.deepEqual(retained.sort(), ['ADJACENT', 'SAME', 'SELECTED'])
  assert.equal(scope.pcbViaIds.length, 2, 'adjacent-layer full physical barrels are retained')
  assert.equal(scope.pcbCopperPourIds.length, 2, 'return copper and nearby other-net plane remain visible')
  assert.deepEqual(copperScopeRejections(scope), ['Channel scope requires multi-net plane extraction for 1 nearby non-reference pours', 'Channel scope requires pad-only neighbour extraction for 1 physical ports'])
  assert.equal(scope.openPadIds.length, 1, 'unused disconnected leads retain their explicit open-pad approximation')
  assert.equal(scope.omitted.traces, 2)
})
