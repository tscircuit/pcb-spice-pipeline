import React from 'react'
import { Inverter, Reference } from './parts'

// Received-strobe timing mechanics using the real CMOS buffers, not a DDR memory model.
export default () => <board width={16} height={12} thickness={1.6} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
  {[0, 1].map(i => <React.Fragment key={i}>
    <Inverter name={`TX${i}`} x={-5} y={i * .6} driver /><Inverter name={`RX${i}`} x={5} y={i * .6} driver={false} />
    <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.2} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
  </React.Fragment>)}
  <Reference />
  <signalintegrity name="STROBE" bitRate={20e6} duration={48 / 20e6} pdn="ideal">
    <signal name="DQS" driver=".TX0 > .Y" receiver=".RX0 > .A" pattern="clock" offset={25e-9} />
    <signal name="DQ" driver=".TX1 > .Y" receiver=".RX1 > .A" strobe="DQS" mask={{ setup: 75e-12, hold: 100e-12 }} />
  </signalintegrity>
</board>
