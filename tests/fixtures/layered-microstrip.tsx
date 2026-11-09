import React from 'react'
import { modeling as channelModeling } from './native-channel'

/** Straight top-layer microstrip(s) over an unbroken bottom reference, with no vias or bends. */
export default function LayeredMicrostrip({ coupled = false }: { coupled?: boolean }): React.JSX.Element {
  const count = coupled ? 2 : 1
  return <board width={50} height={14} layers={2} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    {(['TX', 'RX'] as const).map((name, i) => <chip key={name} name={name} pcbX={i ? 20 : -20}
      pinLabels={{ pin1: 'S0', pin2: 'S1', pin3: 'GND' }} connections={{ GND: 'net.GND' }}
      footprint={<footprint>
        {Array.from({ length: count }, (_, j) => <React.Fragment key={j}><smtpad portHints={[`pin${j + 1}`]} pcbX={0} pcbY={j * .75}
          width={.15} height={.15} shape="rect" /></React.Fragment>)}
        <smtpad portHints={['pin3']} pcbX={0} pcbY={-3} width={.3} height={.3} shape="rect" layer="bottom" />
      </footprint>} />)}
    {Array.from({ length: count }, (_, j) => <React.Fragment key={j}><trace from={`.TX > .S${j}`} to={`.RX > .S${j}`}
      width={.15} pcbPath={[`.TX > .S${j}`, `.RX > .S${j}`]} /></React.Fragment>)}
    <copperpour connectsTo="net.GND" layer="bottom" unbroken />
  </board>
}

export const modeling = { ...channelModeling, viaPlatingMm: .018, relativePermittivity: 4.42,
  lanes: [0, 1].map(i => ({ port: `S${i}`, from: { component: 'TX', port: `S${i}` }, to: { component: 'RX', port: `S${i}` } })),
  extraction: { ...channelModeling.extraction, maxPanelLengthMm: 2.86 } }
