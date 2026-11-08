import React from 'react'
import type {CircuitJson} from 'circuit-json'
import {outputPad} from '../../examples/single-ended/models'
import {Circuit,analog} from '@tscircuit/core'
import {Sc70Pads} from '../../examples/differential-data/pcb'
import {twoLayerStackup} from '../../examples/stackup'

/** Exercise actual JSX prop serialization and Circuit JSON admission with long physical traffic. */
export async function longPatternBoard(bits: string): Promise<CircuitJson> {
  const circuit=new Circuit()
  circuit.add(<board width={8} height={8} layers={2} thickness={1.6} pcbStackup={twoLayerStackup} routingDisabled schematicDisabled>
    <chip name="TX" footprint={<Sc70Pads />} pinLabels={{pin1:'NC',pin2:'A',pin3:'GND',pin4:'Y',pin5:'VCC'}} />
    <ibismodel componentRef=".TX" {...outputPad} />
    <analog.transientsimulation name="SI" spiceEngine="pcb_spice" duration="1600ns" timePerStep="50ps" ibisPinStates={{".TX > .Y":{isOutput:true,isOutputEnabled:true}}} />
    <analog.digitalstimulus name="DATA" simulationRef=".SI" sourcePinRef=".TX > .Y" bitDuration="50ns"
      startTime="0ns" initialState={0} transmittedData={{transmissionType:'bits',bits,repeat:true}} />
  </board>)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
