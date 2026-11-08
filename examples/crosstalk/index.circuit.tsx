import { Circuit, analog } from '@tscircuit/core'
import React, { Fragment } from 'react'
import { Sc70Pads, RoutedTrace } from '../differential-data/pcb'
import { inputPad, outputPad } from '../single-ended/models'
import lock from '../vendor-models.lock.json'

export const modeling = {
  lanes: [0, 1, 2].map(i => ({ port: `D${i}`, from: { component: `TX${i}`, port: 'Y' }, to: { component: `RX${i}`, port: 'A' } })),
  ibisModelAssetSha256: { [`models/${lock.models.cmos.file}`]: lock.models.cmos.sha256 },
}

/** Three real SC70 pad links, with physical ground copper and explicit TI buffer declarations. */
export async function makeBoard(quietMiddle = false, multilayer = false) {
  const circuit = new Circuit()
  const count = multilayer ? 1 : 3
  circuit.add(<board width={40} height={24} layers={2} thickness={1.6} routingDisabled schematicDisabled>
    <net name="GND" /><net name="VCC" />
    <voltagesource name="SUPPLY" voltage="3.3V" doNotPlace connections={{ pin1: 'net.VCC', pin2: 'net.GND' }} />
    {Array.from({ length: count }, (_, i) => {
      const y = (i - (count - 1) / 2) * 5
      return <Fragment key={i}>
        <chip name={`TX${i}`} manufacturerPartNumber="SN74LVC1G04DCK" pcbX={-14} pcbY={y}
          pinLabels={{ pin1: 'NC', pin2: 'A', pin3: 'GND', pin4: 'Y', pin5: 'VCC' }} footprint={<Sc70Pads />}
          connections={{ GND: 'net.GND', VCC: 'net.VCC' }} />
        <chip name={`RX${i}`} manufacturerPartNumber="SN74LVC1G04DCK" pcbX={14} pcbY={y - .65}
          pinLabels={{ pin1: 'NC', pin2: 'A', pin3: 'GND', pin4: 'Y', pin5: 'VCC' }} footprint={<Sc70Pads />}
          connections={{ GND: 'net.GND', VCC: 'net.VCC' }} />
        {['TX', 'RX'].map((side, j) => <Fragment key={side}>
          <via name={`G${side}${i}`} pcbX={j ? 11 : -16} pcbY={y - 2} holeDiameter={.3} outerDiameter={.6}
            layers={['top', 'bottom']} connectsTo="net.GND" />
          <trace from={`.${side}${i} > .GND`} to={`.G${side}${i} > .top`} thickness={.3}
            pcbPath={[`.${side}${i} > .GND`, `.G${side}${i} > .top`]} />
        </Fragment>)}
        <ibismodel componentRef={`.TX${i}`} {...outputPad} />
        <ibismodel componentRef={`.RX${i}`} {...inputPad} />
        <RoutedTrace name={`D${i}`} from={`.TX${i} > .Y`} to={`.RX${i} > .A`} origin={[-14, y]} width={.15}
          points={multilayer ? [{ x: -8, y: -.65 }, { x: -8, y: -.65, via: true, fromLayer: 'top', toLayer: 'bottom' },
            { x: 8, y: -.65 }, { x: 8, y: -.65, via: true, fromLayer: 'bottom', toLayer: 'top' }]
            : [{ x: -8, y: y - .65 }, { x: -5, y: i * .5 }, { x: 5, y: i * .5 }, { x: 8, y: y - .65 }]} />
        <voltageprobe name={`NEXT${i}`} connectsTo={`.TX${i} > .Y`} referenceTo={`.TX${i} > .GND`} />
        <voltageprobe name={`FEXT${i}`} connectsTo={`.RX${i} > .A`} referenceTo={`.RX${i} > .GND`} />
        <analog.digitalstimulus name={`DATA${i}`} simulationRef=".SI" sourcePinRef={`.TX${i} > .Y`}
          bitDuration="50ns" startTime="0ns" initialState={0}
          transmittedData={{ transmissionType: 'bits', bits: quietMiddle && i === 1 ? '0' : ['00111010', '10100111', '11010010'][i], repeat: true }} />
        <analog.eyediagram name={`EYE${i}`} simulationRef=".SI" probeRef={`.FEXT${i}`}
          unitInterval="50ns" timeOrigin="0ns" startTime="200ns" endTime="1600ns" />
      </Fragment>
    })}
    {/* A U-shaped pour has a split under the layer-changing route, joined outside the slice. */}
    <copperpour name="GROUND" layer={multilayer ? 'top' : 'bottom'} connectsTo="net.GND" unbroken outline={multilayer
      ? [{ x: -19, y: -11 }, { x: 19, y: -11 }, { x: 19, y: 11 }, { x: 1, y: 11 }, { x: 1, y: -8 }, { x: -1, y: -8 }, { x: -1, y: 11 }, { x: -19, y: 11 }]
      : [{ x: -19, y: -11 }, { x: 19, y: -11 }, { x: 19, y: 11 }, { x: -19, y: 11 }]} />
    <analog.transientsimulation name="SI" spiceEngine="pcb_spice" duration="1600ns" timePerStep="50ps"
      ibisPinStates={Object.fromEntries(Array.from({ length: count }, (_, i) => [
        [`.TX${i} > .Y`, { isOutput: true, isOutputEnabled: true }], [`.RX${i} > .A`, { isOutput: false }],
      ]).flat())} />
  </board>)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson()
  return [...records, { type: 'pcb_stackup', pcb_stackup_id: 'physical-stackup',
    pcb_board_id: records.find(r => r.type === 'pcb_board')!.pcb_board_id, plated_hole_copper_thickness: .025,
    layers: [
      { layer_type: 'copper', layer: 'top', thickness: .035, electrical_conductivity_s_per_m: 5.8e7 },
      { layer_type: 'dielectric', thickness: 1.53, relative_permittivity: 4.1, dielectric_loss_tangent: .02 },
      { layer_type: 'copper', layer: 'bottom', thickness: .035, electrical_conductivity_s_per_m: 5.8e7 },
    ] }]
}

export const circuitJson = await makeBoard()
