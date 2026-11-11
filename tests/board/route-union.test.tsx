import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCoreSignals } from '../support/core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes } from '../../src/board'
import { extractRoutes } from '../../src/extraction'

/** Two same-net strips meet exactly at their edges, as on the board's DDR power rail. */
function TouchingRail(): React.JSX.Element {
  return <board width={8} height={5} layers={2} thickness={.4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    {['A', 'B', 'C', 'D'].map((name, i) => <chip key={name} name={name} pcbX={i % 2 ? 2 : -2} pcbY={i < 2 ? 0 : .3}
      pinLabels={{ pin1: 'P' }} connections={{ P: 'net.RAIL' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.15} height={.15} shape="rect" /></footprint>} />)}
    <trace from=".A > .P" to=".B > .P" width={.3} pcbPath={['.A > .P', '.B > .P']} />
    <trace from=".C > .P" to=".D > .P" width={.3} pcbPath={['.C > .P', '.D > .P']} />
    <net name="RAIL" /><net name="GND" /><copperpour connectsTo="net.GND" layer="bottom" unbroken />
  </board>
}

test('TSX touching same-net rail strips reproduce rejected cross-section geometry', async () => {
  const circuit = await renderCoreSignals(<TouchingRail />)
  const rail = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'RAIL')!
  const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
  const scope = channelCopperScope(circuit, connectedSourceIds(circuit, rail.source_net_id), connectedSourceIds(circuit, ground.source_net_id))
  const geometry = segmentRoutes(circuit, scope)
  assert.throws(() => extractRoutes(geometry, { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 }), /Signal rectangles overlap or touch/)
})
