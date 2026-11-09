import React from 'react'
import { Circuit, analog } from '@tscircuit/core'
import { twoLayerStackup } from '../../examples/stackup'
import type { CircuitJson, BoardModeling } from '../../src/board'

/** Reviewer's real copper repro, with optional sloping neighbour, pour, pad or return via. */
export async function reviewBoard(options: { parallel?: boolean; oblique?: boolean; slopingPour?: boolean; via?: boolean; padWidth?: number } = {}): Promise<{ circuitJson: CircuitJson; modeling: BoardModeling }> {
  const ends = options.parallel ? [0, .5, 1.5].map(y => [[-5, y], [5, y]]) : options.oblique ? [[[-6, 0], [6, 0]], [[-6, 1], [6, 4]]] : [[[-5, 0], [5, 0]]]
  const lanes = ends.map((_, i) => ({ port: `L${i}`, from: { component: `U${i}0`, port: 'S' }, to: { component: `U${i}1`, port: 'S' } }))
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<board width={20} height={20} pcbStackup={twoLayerStackup} layers={2} routingDisabled schematicDisabled>
    <net name="GND" />
    <chip name="GROUND_PAD" layer="bottom" pcbX={-8} pcbY={-7} pinLabels={{ pin1: 'GND' }} connections={{ GND: 'net.GND' }} footprint={<footprint><smtpad portHints={['pin1']} width={.2} height={.2} shape="rect" /></footprint>} />
    {ends.map((pts, i) => <React.Fragment key={i}>
      {pts.map(([x, y], j) => <chip key={j} name={`U${i}${j}`} pcbX={x} pcbY={y} pinLabels={{ pin1: 'S', pin2: 'GND' }} connections={{ GND: 'net.GND' }} footprint={<footprint>
        <smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={options.padWidth ?? .3} height={.3} shape="rect" />
        <smtpad portHints={['pin2']} pcbX={0} pcbY={-2} width={.2} height={.2} shape="rect" />
      </footprint>} />)}
      <trace from={`.U${i}0 > .S`} to={`.U${i}1 > .S`} width={.15} pcbPath={[`.U${i}0 > .S`, `.U${i}1 > .S`]} />
    </React.Fragment>)}
    {options.via && <via name="RETURN" pcbX={1} pcbY={1} layers={['top', 'bottom']} holeDiameter={.8} outerDiameter={1.2} connectsTo="net.GND" />}
    <copperpour name="G" layer="bottom" connectsTo="net.GND" unbroken outline={(options.slopingPour ? [[-9,-8],[9,-8],[9,6],[-9,-4]] : [[-9,-8],[9,-8],[9,8],[-9,8]]).map(([x,y]) => ({x,y}))} />
    <analog.transientsimulation name="SI" spiceEngine="pcb_spice" duration="10ns" timePerStep="10ps" pcbSpiceChannel={{ lanes: lanes.map(l => ({ name: l.port, from: `.${l.from.component} > .S`, to: `.${l.to.component} > .S` })) }} />
  </board>)
  await circuit.renderUntilSettled()
  return { circuitJson: circuit.getCircuitJson(), modeling: { lanes } }
}
