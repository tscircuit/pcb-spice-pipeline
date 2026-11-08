import React from 'react'
import { Inverter, Reference } from './parts'

export default () => <board width={16} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
  {[0, 1, 2].map(i => <React.Fragment key={i}>
    <Inverter name={`TX${i}`} x={-5} y={i * .6} driver /><Inverter name={`RX${i}`} x={5} y={i * .6} driver={false} />
    <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.2} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
  </React.Fragment>)}
  <Reference />
  {(['TRAFFIC', 'QUIET_LOW', 'QUIET_HIGH'] as const).map((name, i) => <signalintegrity key={name} name={name} bitRate={20e6} duration={48 / 20e6} pdn="ideal">
    <signal name="D0" driver=".TX0 > .Y" receiver=".RX0 > .A" />
    <signal name="D1" driver=".TX1 > .Y" receiver=".RX1 > .A" quiet={i === 1 ? 'low' : i === 2 ? 'high' : undefined} />
    <signal name="D2" driver=".TX2 > .Y" receiver=".RX2 > .A" />
  </signalintegrity>)}
</board>
