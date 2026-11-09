import React from 'react'
import { Inverter, Reference } from '../../examples/levels/parts'

// Deliberately invalid: data and strobe arrive at different chips. Public preparation must reject it.
export default ({ strobe = 'DQS' }: { strobe?: string } = {}) => <board width={16} height={12} thickness={1.6} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
  {[0, 1].map(i => <React.Fragment key={i}>
    <Inverter name={`TX${i}`} x={-5} y={i * .6} driver /><Inverter name={`RX${i}`} x={5} y={i * .6} driver={false} />
    <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.2} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
  </React.Fragment>)}
  <Reference />
  <signalintegrity name="STROBE" bitRate={20e6} duration={48 / 20e6}>
    <signal name="DQS" driver=".TX0 > .Y" receiver=".RX0 > .A" pattern="clock" offset={25e-9} />
    <signal name="DQ" driver=".TX1 > .Y" receiver=".RX1 > .A" strobe={strobe} mask={{ setup: 75e-12, hold: 100e-12 }} />
  </signalintegrity>
</board>
