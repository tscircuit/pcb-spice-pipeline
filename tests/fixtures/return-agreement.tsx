import React from 'react'

/** Straight TSX microstrips with broad end contacts on a close, solid bottom reference.
 * Direct opposite-layer contacts remove ground leads and vias from the return.
 * The physical 0.4 mm dielectric comes from the JLC two-layer stackup, without rescaling.
 */
export default function ReturnAgreement({ spacing = .3, count = 3 }: { spacing?: number; count?: number }): React.JSX.Element {
  const half = (count - 1) * spacing / 2 + 1
  return <board width={12} height={2 * half + 1} layers={2} thickness={.4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    {['TX', 'RX'].map((name, i) => <chip key={name} name={name} pcbX={i ? 5 : -5}
      pinLabels={{ pin1: 'S0', pin2: 'S1', pin3: 'S2', pin4: 'GND' }} connections={{ GND: 'net.GND' }}
      footprint={<footprint>
        {Array.from({ length: count }, (_, j) => <React.Fragment key={j}><smtpad portHints={[`pin${j + 1}`]} pcbX={0} pcbY={(j - (count - 1) / 2) * spacing} width={.15} height={.15} shape="rect" /></React.Fragment>)}
        <smtpad portHints={['pin4']} pcbX={0} pcbY={0} width={.3} height={2 * half} shape="rect" layer="bottom" />
      </footprint>} />)}
    {Array.from({ length: count }, (_, j) => <React.Fragment key={j}><trace from={`.TX > .S${j}`} to={`.RX > .S${j}`} width={.15} pcbPath={[`.TX > .S${j}`, `.RX > .S${j}`]} /></React.Fragment>)}
    <net name="GND" />
    <copperpour connectsTo="net.GND" layer="bottom" unbroken />
  </board>
}
