import { twoLayerStackup } from '../stackup'
import React from "react"
import { Circuit, analog } from "@tscircuit/core"
import type { JSX } from "react"
import type { CircuitJson } from "circuit-json"
import { inputPad, outputPad } from "./models"
import { BenchSupply, RoutedTrace, Sc70Pads } from "../differential-data/pcb"
import construction from "./board-construction.json"
import { modeling } from "./simulation.config"
export { modeling }

const pins = { pin1: "NC", pin2: "A", pin3: "GND", pin4: "Y", pin5: "VCC" }

/** Explicit CMOS output-pad data; this does not simulate the inverter core. */
function Board({ includePackageParasitics }: { includePackageParasitics: boolean }): JSX.Element {
  return <board width={construction.widthMm} height={construction.heightMm}
    thickness={construction.thicknessMm} layers={2} pcbStackup={twoLayerStackup} routingDisabled schematicDisabled>
    <chip name="TX" manufacturerPartNumber="SN74LVC1G04DCK" pcbX={-15} pcbY={0}
      pinLabels={pins} footprint={<Sc70Pads />}  />
    <chip name="RX" manufacturerPartNumber="SN74LVC1G04DCK" pcbX={15} pcbY={0}
      pinLabels={pins} footprint={<Sc70Pads />}  />
    <ibismodel componentRef=".TX" {...outputPad} includePackageParasitics={includePackageParasitics} />
    <ibismodel componentRef=".RX" {...inputPad} includePackageParasitics={includePackageParasitics} />
    <BenchSupply />
    <net name="GND" />
    <trace from=".TX > .GND" to="net.GND" />
    <copperpour name="REFERENCE" layer="bottom" connectsTo="net.GND" unbroken outline={[
      {x:-18,y:-5},{x:18,y:-5},{x:18,y:.3},{x:-18,y:.3},
    ]} />
    <RoutedTrace name="CMOS_DATA" from=".TX > .Y" to=".RX > .A" origin={[-15, 0]}
      points={[{ x: -12, y: -0.65 }, { x: -12, y: 0 }]} />
    <RoutedTrace from=".PWR > .VCC" to=".TX > .VCC" origin={[-22, 7]} width={0.35}
      points={[{ x: -23, y: 6, via: true, fromLayer: "top", toLayer: "bottom" }, { x: -13, y: 6 }, { x: -13, y: 0.65, via: true, fromLayer: "bottom", toLayer: "top" }]} />
    <RoutedTrace from=".TX > .VCC" to=".RX > .VCC" origin={[-15, 0]} width={0.35}
      points={[{ x: -13, y: 0.65, via: true, fromLayer: "top", toLayer: "bottom" }, { x: -13, y: 6 }, { x: 17, y: 6 }, { x: 17, y: 0.65, via: true, fromLayer: "bottom", toLayer: "top" }]} />
    <RoutedTrace from=".PWR > .GND" to=".TX > .GND" origin={[-22, 7]} width={0.35}
      points={[{ x: -21, y: 5, via: true, fromLayer: "top", toLayer: "bottom" }, { x: -17, y: 5 }, { x: -17, y: -0.65, via: true, fromLayer: "bottom", toLayer: "top" }]} />
    <RoutedTrace name="GROUND_RETURN" from=".TX > .GND" to=".RX > .GND" origin={[-15, 0]} width={0.35}
      points={[{ x: -17, y: -0.65, via: true, fromLayer: "top", toLayer: "bottom" }, { x: -17, y: -6 }, { x: 13, y: -6 }, { x: 13, y: -0.65, via: true, fromLayer: "bottom", toLayer: "top" }]} />
    <analog.transientsimulation pcbSpiceChannel={{lanes:modeling.lanes.map(l=>({name:l.port,from:`.${l.from.component} > .${l.from.port}`,to:`.${l.to.component} > .${l.to.port}`}))}} spiceEngine="pcb_spice" name="SI" duration="1600ns" timePerStep="50ps" ibisPinStates={{
      ".TX > .Y": { isOutput: true, isOutputEnabled: true }, ".RX > .A": { isOutput: false },
    }} />
    <analog.digitalstimulus name="DATA" simulationRef=".SI" sourcePinRef=".TX > .Y"
      bitDuration="50ns" startTime="0ns" initialState={0}
      transmittedData={{ transmissionType: "bits", bits: "001110100101011000101101", repeat: true }} />
    <voltageprobe name="DATA_RX" connectsTo=".RX > .A" referenceTo=".RX > .GND" />
    <analog.eyediagram name="CMOS_DATA" simulationRef=".SI" probeRef=".DATA_RX"
      unitInterval="50ns" timeOrigin="0ns" startTime="200ns" endTime="1600ns" />
    <voltageprobe name="DATA_TX" connectsTo=".TX > .Y" referenceTo=".TX > .GND" />
    <analog.eyediagram name="CMOS_TX" simulationRef=".SI" probeRef=".DATA_TX"
      unitInterval="50ns" timeOrigin="0ns" startTime="200ns" endTime="1600ns" />
    <pcbnotetext pcbY={9} text="DESIGNED CMOS PAD/CHANNEL TEST" fontSize={0.8} />
  </board>
}

/** Generate the actual board; package parasitics are an IBIS declaration, never an extraction control. */
export async function makeBoard(includePackageParasitics: boolean = false): Promise<CircuitJson> {
  const circuit = new Circuit()
  circuit.add(<Board includePackageParasitics={includePackageParasitics} />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
export const circuitJson = await makeBoard()
