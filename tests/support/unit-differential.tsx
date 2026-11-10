import { simulation } from '@tscircuit/core'
// Topology/transient unit-test source only; not an RFC native board.
import React from 'react'
import { Transceiver, Reference } from './signal-parts'

export default () => <board width={20} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
  <Transceiver name="TX" x={-5} /><Transceiver name="RX" x={5} /><Reference />
  <trace from=".TX > .A" to=".RX > .A" width={.2} pcbPath={['.TX > .A', '.RX > .A']} />
  <trace from=".TX > .B" to=".RX > .B" width={.2} pcbPath={['.TX > .B', '.RX > .B']} />
  <resistor name="RTERM" resistance="120" pcbX={5} connections={{ pin1: '.RX > .A', pin2: '.RX > .B' }} footprint={<footprint>
    <smtpad portHints={['pin1']} pcbX={0} pcbY={.3} width={.25} height={.25} shape="rect" />
    <smtpad portHints={['pin2']} pcbX={0} pcbY={-.3} width={.25} height={.25} shape="rect" />
  </footprint>} />
  <simulation.pcbtransientchannelsimulation name="RS485" bitRate={250e3} duration={48 / 250e3}>
    <simulation.pcbchannel name="BUS" driverRef={{ p: '.TX > .A', n: '.TX > .B' }} receiverRef={{ p: '.RX > .A', n: '.RX > .B' }} />
  </simulation.pcbtransientchannelsimulation>
</board>
