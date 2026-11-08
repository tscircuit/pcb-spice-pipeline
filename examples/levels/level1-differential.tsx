import React from 'react'
import { Transceiver, Reference } from './parts'

export default () => <board width={20} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
  <Transceiver name="TX" x={-5} /><Transceiver name="RX" x={5} /><Reference />
  <trace from=".TX > .A" to=".RX > .A" width={.2} pcbPath={['.TX > .A', '.RX > .A']} />
  <trace from=".TX > .B" to=".RX > .B" width={.2} pcbPath={['.TX > .B', '.RX > .B']} />
  <resistor name="RTERM" resistance="120" footprint="0603" pcbX={7} connections={{ pin1: '.RX > .A', pin2: '.RX > .B' }} />
  <signalintegrity name="RS485" bitRate={250e3} duration={48 / 250e3} pdn="ideal">
    <signal name="BUS" driver={{ p: '.TX > .A', n: '.TX > .B' }} receiver={{ p: '.RX > .A', n: '.RX > .B' }} />
  </signalintegrity>
</board>
