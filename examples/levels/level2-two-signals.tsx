import React from 'react'
import { Inverter, Reference } from './parts'

export default () => <board width={16} height={12} thickness={1.6} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
  {[0, 1].map(i => <React.Fragment key={i}>
    <Inverter name={`TX${i}`} x={-5} y={i * .6} driver /><Inverter name={`RX${i}`} x={5} y={i * .6} driver={false} />
    <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.2} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
  </React.Fragment>)}
  <Reference />
  <signalintegrity name="TWO" bitRate={20e6} duration={48 / 20e6}>
    <signal name="D0" driver=".TX0 > .Y" receiver=".RX0 > .A" />
    <signal name="D1" driver=".TX1 > .Y" receiver=".RX1 > .A" />
  </signalintegrity>
</board>
