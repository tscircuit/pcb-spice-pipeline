import { Circuit } from '@tscircuit/core'
import React from 'react'
import type { AnyCircuitElement } from 'circuit-json'

export type ChannelOptions = { vias?: boolean }
const points: [number, number][] = [[-3, 0], [3, 0]]

/** A minimal four-layer TX-to-RX DQ channel on a ground pour, optionally routed through inner2 by two vias. */
export function NativeChannel({ vias = false }: ChannelOptions): React.JSX.Element {
  const local = points.map(([x, y]) => ({ x: x - points[0][0], y: y - points[0][1] }))
  return <board width={60} height={60} thickness={1.6} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    {(['TX', 'RX'] as const).map((name, i) => <chip key={name} name={name}
      pcbX={points[i ? points.length - 1 : 0][0]} pcbY={points[i ? points.length - 1 : 0][1]}
      pinLabels={{ pin1: 'DQ', pin2: 'GND' }} connections={{ GND: 'net.GND' }}
      footprint={<footprint>
        <smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.3} height={.3} shape="rect" />
        <smtpad portHints={['pin2']} pcbX={0} pcbY={-1} width={.3} height={.3} shape="rect" />
      </footprint>} />)}
    <trace name="DQ_ROUTE" from=".TX > .DQ" to=".RX > .DQ" width={.1} pcbPath={[
      '.TX > .DQ',
      ...(vias ? [{ ...local[0], via: true as const, fromLayer: 'top' as const, toLayer: 'inner2' as const }] : []),
      ...local,
      ...(vias ? [{ ...local.at(-1)!, via: true as const, fromLayer: 'inner2' as const, toLayer: 'top' as const }] : []),
      '.RX > .DQ',
    ]} />
    {(['TX', 'RX'] as const).map((name, i) => <React.Fragment key={`ground-${name}`}>
      <via name={`GND_${name}`} pcbX={points[i ? points.length - 1 : 0][0] + .4}
        pcbY={points[i ? points.length - 1 : 0][1] - 1} layers={['top', 'inner1', 'inner2', 'bottom']}
        holeDiameter={.2} outerDiameter={.4} connectsTo="net.GND" />
      <trace from={`.${name} > .GND`} to={`.GND_${name} > .top`}
        connectsTo={[`.${name} > .GND`, `.GND_${name} > .top`, 'net.GND']}
        width={.15} pcbPath={[`.${name} > .GND`, `.GND_${name} > .top`]} />
    </React.Fragment>)}
    <net name="GND" />
    <copperpour name="REFERENCE" layer="bottom" connectsTo="net.GND" unbroken
      outline={[{ x: -7, y: 2 }, { x: 7, y: 2 }, { x: 7, y: -29 }, { x: -7, y: -29 }]} />
  </board>
}

/** Renders the NativeChannel board through tscircuit core and returns its Circuit JSON. */
export async function nativeChannel(options: ChannelOptions = {}): Promise<AnyCircuitElement[]> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<NativeChannel {...options} />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
