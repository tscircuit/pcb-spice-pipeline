import React from 'react'
import { Circuit } from '@tscircuit/core'
import type { CircuitJson, BoardModeling } from '../../src/board'

/** Wide opposing strips approach the one-face proximity-current limit in NBS J. Res. 84, eqs. 2.3/3.3. */
export async function slabBoard(): Promise<{ circuitJson: CircuitJson; modeling: BoardModeling }> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<board width={20} height={22} layers={2} routingDisabled schematicDisabled pcbStackup={{ layers: [
    { layer_type: 'copper', layer: 'top', thickness: .035, electrical_conductivity_s_per_m: 5.8e7 },
    { layer_type: 'dielectric', thickness: .02, relative_permittivity: 4.1, loss_tangent: 0 },
    { layer_type: 'copper', layer: 'bottom', thickness: .035, electrical_conductivity_s_per_m: 5.8e7 },
  ] }}>
    <net name="GND" />
    <chip name="GROUND" layer="bottom" pcbX={-8} pinLabels={{ pin1: 'GND' }} connections={{ GND: 'net.GND' }} footprint={<footprint>
      <smtpad portHints={['pin1']} width={.2} height={.2} shape="rect" />
    </footprint>} />
    {[-5, 5].map((x, i) => <chip key={i} name={`U${i}`} pcbX={x} pinLabels={{ pin1: 'S', pin2: 'GND' }} connections={{ GND: 'net.GND' }} footprint={<footprint>
      <smtpad portHints={['pin1']} width={.2} height={.2} shape="rect" />
      <smtpad portHints={['pin2']} pcbY={-10.5} width={.2} height={.2} shape="rect" />
    </footprint>} />)}
    <trace from=".U0 > .S" to=".U1 > .S" width={20} pcbPath={['.U0 > .S', '.U1 > .S']} />
    <copperpour name="RETURN" layer="bottom" connectsTo="net.GND" unbroken outline={[{x:-9,y:-10},{x:9,y:-10},{x:9,y:10},{x:-9,y:10}]} />
  </board>)
  await circuit.renderUntilSettled()
  return { circuitJson: circuit.getCircuitJson(), modeling: { lanes: [{ port: 'S', from: { component: 'U0', port: 'S' }, to: { component: 'U1', port: 'S' } }] } }
}
