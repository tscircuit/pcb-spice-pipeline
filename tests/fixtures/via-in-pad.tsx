import { Circuit } from '@tscircuit/core'
import React from 'react'

export type ViaPadOptions = { offset?: number; viaNet?: 'ground' | 'other'; viaEnd?: 'inner1' | 'inner2'; planeLayer?: 'inner1' | 'inner2'; duplicate?: boolean; planeMiss?: boolean; planeEdge?: number }

// The GND lands have no routed leads: each via is part of the land itself.
export function ViaInPad({ offset = 0, viaNet = 'ground', viaEnd = 'inner1', planeLayer = 'inner1', duplicate = false, planeMiss = false, planeEdge = -5.5 }: ViaPadOptions) {
  return <board width={12} height={8} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {(['TX', 'RX'] as const).map((name, i) => <chip key={name} name={name} pcbX={i ? 3 : -3}
      pinLabels={{ pin1: 'DQ', pin2: 'GND' }} connections={{ DQ: 'net.DQ', GND: 'net.GND' }} footprint={<footprint>
        <smtpad portHints={['pin1']} pcbX={0} pcbY={0} shape="circle" radius={.2} />
        <smtpad portHints={['pin2']} pcbX={0} pcbY={-1} shape="circle" radius={.2} />
      </footprint>} />)}
    <trace from=".TX > .DQ" to=".RX > .DQ" width={.1} pcbPath={['.TX > .DQ', '.RX > .DQ']} />
    {(['TX', 'RX'] as const).map((name, i) => <React.Fragment key={name}><via name={`G${name}`} pcbX={(i ? 3 : -3) + offset} pcbY={-1}
      fromLayer="top" toLayer={viaEnd} holeDiameter={.15} outerDiameter={.3}
      connectsTo={viaNet === 'ground' ? `.${name} > .GND` : 'net.OTHER'} /></React.Fragment>)}
    {duplicate && <via name="EXTRA" pcbX={-3} pcbY={-1} fromLayer="top" toLayer={viaEnd} holeDiameter={.15} outerDiameter={.3} connectsTo=".TX > .GND" />}
    <copperpour name="REFERENCE" layer={planeLayer} connectsTo="net.GND" unbroken
      outline={[{ x: planeMiss ? -2 : planeEdge, y: -3.5 }, { x: 5.5, y: -3.5 }, { x: 5.5, y: 3.5 }, { x: planeMiss ? -2 : planeEdge, y: 3.5 }]} />
  </board>
}

export async function viaInPad(options: ViaPadOptions = {}) {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, netlistDrcChecksDisabled: true } })
  circuit.add(<ViaInPad {...options} />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
