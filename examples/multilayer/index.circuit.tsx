import { fourLayerStackup } from '../stackup'
import React from 'react'
import type { CircuitJson } from 'circuit-json'
import { Circuit, analog } from '@tscircuit/core'
import { Sc70Pads } from '../differential-data/pcb'
import { outputPad, inputPad } from '../single-ended/models'
import lock from '../vendor-models.lock.json'

export const modeling = {lanes:[{port:'DATA',from:{component:'TX',port:'Y'},to:{component:'RX',port:'A'}}],
  ibisModelAssetSha256:{[`models/${lock.models.cmos.file}`]:lock.models.cmos.sha256}}
/** Render the same routed board with an explicit physical construction. */
export async function makeBoard(construction: typeof fourLayerStackup = fourLayerStackup): Promise<CircuitJson> {
  const circuit = new Circuit()
  circuit.add(<board width={40} height={24} layers={4} thickness={1.6} pcbStackup={construction} allowBlindAndBuriedVias routingDisabled schematicDisabled>
    <net name="GND" /><net name="VCC" />
    <voltagesource name="SUPPLY" voltage="3.3V" doNotPlace connections={{pin1:'net.VCC',pin2:'net.GND'}} />
    {['TX','RX'].map((name,i)=><React.Fragment key={name}>
      <chip name={name} pcbX={i?14:-14} pcbY={i?-.65:0} manufacturerPartNumber="SN74LVC1G04DCK"
        pinLabels={{pin1:'NC',pin2:'A',pin3:'GND',pin4:'Y',pin5:'VCC'}} footprint={<Sc70Pads />}
        connections={{GND:'net.GND',VCC:'net.VCC'}} />
      <ibismodel componentRef={`.${name}`} {...(i?inputPad:outputPad)} />
      <via name={`G${name}`} pcbX={i?11:-16} pcbY={-2} holeDiameter={.3} outerDiameter={.6}
        layers={['top','inner1','inner2','bottom']} connectsTo="net.GND" />
      <trace from={`.${name} > .GND`} to={`.G${name} > .top`} thickness={.3}
        pcbPath={[`.${name} > .GND`,`.G${name} > .top`]} />
    </React.Fragment>)}
    <trace name="DATA" from=".TX > .Y" to=".RX > .A" thickness={.15} pcbPath={[
      '.TX > .Y',{x:6,y:0},{x:6,y:0,via:true,fromLayer:'top',toLayer:'inner2'},
      {x:22,y:0},{x:22,y:0,via:true,fromLayer:'inner2',toLayer:'top'},'.RX > .A',
    ]} pcbPathRelativeTo=".TX > .Y" />
    {(['inner1','bottom'] as const).map(layer=><React.Fragment key={layer}><copperpour name={`GROUND_${layer}`} layer={layer}
      connectsTo="net.GND" clearance={.2} coveredWithSolderMask={false} outline={[
        {x:-19,y:-11},{x:19,y:-11},{x:19,y:11},{x:1,y:11},{x:1,y:-8},{x:-1,y:-8},{x:-1,y:11},{x:-19,y:11},
      ]} /></React.Fragment>)}
    <analog.transientsimulation pcbSpiceChannel={{lanes:modeling.lanes.map(l=>({name:l.port,from:`.${l.from.component} > .${l.from.port}`,to:`.${l.to.component} > .${l.to.port}`}))}} name="SI" spiceEngine="pcb_spice" duration="1600ns" timePerStep="50ps"
      ibisPinStates={{'.TX > .Y':{isOutput:true,isOutputEnabled:true},'.RX > .A':{isOutput:false}}} />
    <analog.digitalstimulus name="DATA" simulationRef=".SI" sourcePinRef=".TX > .Y" bitDuration="50ns" startTime="0ns" initialState={0}
      transmittedData={{transmissionType:'bits',bits:'0011101001010110',repeat:true}} />
    <voltageprobe name="RX" connectsTo=".RX > .A" referenceTo=".RX > .GND" />
    <voltageprobe name="TX" connectsTo=".TX > .Y" referenceTo=".TX > .GND" />
    <analog.eyediagram name="RX_EYE" simulationRef=".SI" probeRef=".RX" unitInterval="50ns" timeOrigin="0ns" startTime="200ns" endTime="1600ns" />
  </board>)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
export const circuitJson = await makeBoard()
