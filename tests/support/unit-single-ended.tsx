// Topology/transient unit-test source only; not an RFC native board.
import React from 'react'
import { Inverter, Reference } from './signal-parts'

export default () => <board width={16} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
  <Inverter name="TX" x={-5} y={0} driver /><Inverter name="RX" x={5} y={0} driver={false} />
  <Reference />
  <trace from=".TX > .Y" to=".RX > .A" width={.2} pcbPath={['.TX > .Y', '.RX > .A']} />
  <signalintegrity name="SINGLE" bitRate={20e6} duration={48 / 20e6}>
    <signal name="DATA" driver=".TX > .Y" receiver=".RX > .A" />
  </signalintegrity>
</board>
