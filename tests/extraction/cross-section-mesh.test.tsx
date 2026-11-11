import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCoreSignals } from '../support/core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes } from '../../src/board'
import { routeCrossSection, solveCrossSection } from '../../src/extraction'

/** Different-layer strip edges share a projection: 0.1/2 equals 0.2 - 0.3/2 physically. */
function AlignedEdges(): React.JSX.Element {
  return <board width={8} height={12} layers={8} thickness={1.2} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled allowBlindAndBuriedVias>
    {['A', 'B', 'C', 'D'].map((name, i) => <chip key={name} name={name} pcbX={i < 2 ? -1 : 1} pcbY={i % 2 ? 4 : -4}
      pinLabels={{ pin1: 'P' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" /></footprint>} />)}
    {(['inner4', 'inner5'] as const).map((layer, i) => <React.Fragment key={layer}><trace from={i ? '.C > .P' : '.A > .P'} to={i ? '.D > .P' : '.B > .P'} width={i ? .3 : .1}
      pcbPath={[i ? '.C > .P' : '.A > .P', { x: 0, y: 1 }, { x: 0, y: 1, via: true, fromLayer: 'top', toLayer: layer },
        { x: i ? -1 : 1.2, y: 2 }, { x: i ? -1 : 1.2, y: 6 }, { x: 0, y: 7 }, { x: 0, y: 7, via: true, fromLayer: layer, toLayer: 'top' }, i ? '.D > .P' : '.B > .P']} /></React.Fragment>)}
    <net name="GND" /><copperpour connectsTo="net.GND" layer="inner3" unbroken /><copperpour connectsTo="net.GND" layer="inner6" unbroken />
  </board>
}

test('TSX aligned projections reproduce a singular microscopic dielectric panel', async () => {
  const circuit = await renderCoreSignals(<AlignedEdges />)
  const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
  const selected = new Set(circuit.filter(record => record.type === 'source_trace').flatMap(trace => trace.connected_source_port_ids))
  const geometry = segmentRoutes(circuit, channelCopperScope(circuit, selected, connectedSourceIds(circuit, ground.source_net_id)))
  const slice = geometry.slices.find(slice => slice.wires.length === 2 && slice.wires.every(wire => wire.u[1] === 1))!
  assert.ok(slice)
  const section = routeCrossSection(geometry, slice, { maskMm: .02, maskEr: 3.3, maskLoss: .025, substrateLoss: .02 })
  assert.throws(() => solveCrossSection(section), /Singular cross-section boundary matrix/, JSON.stringify(section))
})
