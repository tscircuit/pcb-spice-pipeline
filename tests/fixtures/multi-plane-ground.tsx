import { Circuit } from '@tscircuit/core'
import React from 'react'

// Two reference vias pass through three separate solid ground planes.
export function MultiPlaneGround() {
  return <board width={12} height={8} layers={8} thickness={1.2} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {(['TX', 'RX'] as const).map((name, i) => <chip key={name} name={name} pcbX={i ? 3 : -3}
      pinLabels={{ pin1: 'DQ', pin2: 'GND' }} connections={{ DQ: 'net.DQ', GND: 'net.GND' }} footprint={<footprint>
        <smtpad portHints={['pin1']} pcbX={0} pcbY={0} shape="circle" radius={.2} />
        <smtpad portHints={['pin2']} pcbX={0} pcbY={-1} shape="circle" radius={.2} />
      </footprint>} />)}
    <trace from=".TX > .DQ" to=".RX > .DQ" width={.1} pcbPath={['.TX > .DQ', '.RX > .DQ']} />
    {(['TX', 'RX'] as const).map((name, i) => <React.Fragment key={name}><via name={`G${name}`} pcbX={i ? 3 : -3} pcbY={-1}
      fromLayer="top" toLayer="inner6" holeDiameter={.15} outerDiameter={.3} connectsTo={`.${name} > .GND`} /></React.Fragment>)}
    {(['inner1', 'inner3', 'inner6'] as const).map(layer => <React.Fragment key={layer}><copperpour name={`GND_${layer}`} layer={layer}
      connectsTo="net.GND" unbroken outline={[{ x: -5.5, y: -3.5 }, { x: 5.5, y: -3.5 }, { x: 5.5, y: 3.5 }, { x: -5.5, y: 3.5 }]} /></React.Fragment>)}
  </board>
}

export async function multiPlaneGround() {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, netlistDrcChecksDisabled: true } })
  circuit.add(<MultiPlaneGround />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
