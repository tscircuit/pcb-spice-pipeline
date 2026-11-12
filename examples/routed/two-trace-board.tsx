import React from 'react'
import { simulation } from '@tscircuit/core'

/** Two physical 8 mm traces; vendor bytes must be supplied locally. */
export function TwoTraceBoard(): React.JSX.Element {
  return <board width={16} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {[0, 1].map(i => <React.Fragment key={i}>
      {[-4, 4].map(x => {
        const name = `${x < 0 ? 'TX' : 'RX'}${i}`
        const pin = x < 0 ? '4' : '2'
        const label = x < 0 ? 'Y' : 'A'
        const y = i * .35
        const ground = -2.5 - i
        const power = 2.5 + i
        return <React.Fragment key={name}>
          <chip name={name} pcbX={x} pcbY={y} pinLabels={{ pin2: 'A', pin3: 'GND', pin4: 'Y', pin5: 'VCC' }} connections={{ GND: 'net.GND', VCC: 'net.VCC' }} footprint={<footprint>
            <smtpad portHints={[`pin${pin}`]} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" />
            <smtpad portHints={['pin3']} pcbX={0} pcbY={ground} width={.4} height={.4} shape="rect" />
            <smtpad portHints={['pin5']} pcbX={0} pcbY={power} width={.4} height={.4} shape="rect" />
          </footprint>} />
          <via name={`G_${name}`} pcbX={x} pcbY={y + ground} fromLayer="top" toLayer="bottom" holeDiameter={.15} outerDiameter={.3} connectsTo={`.${name} > .GND`} />
          <simulation.ibismodel componentRef={`.${name}`} ibisModelAsset={{ project_relative_path: 'models/sn74lvc1g04.ibs', url: './models/sn74lvc1g04.ibs', mimetype: 'text/plain' }} ibisComponentName="LVC1G04_DCK"
            ibisPinNameToPortLabel={{ [pin]: label, '3': 'GND', '5': 'VCC' }} ibisPinNameToModelName={{ [pin]: x < 0 ? 'LVC1G04_OUT_33' : 'LVC1G04_IN_33' }}
            ibisPinNameToReferencePortLabels={{ [pin]: { pullup: 'VCC', pulldown: 'GND', powerClamp: 'VCC', groundClamp: 'GND' } }} />
        </React.Fragment>
      })}
      <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.1} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
    </React.Fragment>)}
    <net name="GND" /><net name="VCC" />
    <copperpour name="POWER" connectsTo="net.VCC" layer="top" unbroken outline={[{ x: -7, y: 2.3 }, { x: 7, y: 2.3 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
    <copperpour name="RETURN" connectsTo="net.GND" layer="bottom" unbroken outline={[{ x: -7, y: -5 }, { x: 7, y: -5 }, { x: 7, y: 5 }, { x: -7, y: 5 }]} />
    <simulation.pcbtransientchannelsimulation name="TWO" bitRate="400Mbps" duration={4e-9}>
      <simulation.pcbchannel name="DATA" driverRef=".TX0 > .Y" receiverRef=".RX0 > .A" pattern="01" />
      <simulation.pcbchannel name="VICTIM" driverRef=".TX1 > .Y" receiverRef=".RX1 > .A" pattern="0" />
    </simulation.pcbtransientchannelsimulation>
  </board>
}
