// Geometry recovered from si-api-review/iter1/e2e/boards.tsx; no hand-authored Circuit JSON.
import { Circuit } from '@tscircuit/core'
import type { CircuitJson } from 'circuit-json'
import React from 'react'
import { RoutedTrace as Route } from '../../examples/differential-data/pcb'

/** Original ground-pad-to-via routing from the measured TSX board. */
function GroundVia({ chip, via }: { chip: string; at: [number, number]; via: [number, number] }): React.JSX.Element {
  return <>
    <via name={`GV_${chip}`} pcbX={via[0]} pcbY={via[1]} layers={["top", "bottom"]} holeDiameter={0.3} outerDiameter={0.6} connectsTo="net.GND" />
    <trace from={`.${chip} > .GND`} to={`.GV_${chip} > .top`} connectsTo={[`.${chip} > .GND`, `.GV_${chip} > .top`, "net.GND"]}
      thickness={0.3} pcbPath={[`.${chip} > .GND`, `.GV_${chip} > .top`]} />
  </>
}

const HVD = { pin1:'R', pin2:'RE_N', pin3:'DE', pin4:'D', pin5:'GND', pin6:'A', pin7:'B', pin8:'VCC' }
/** Original ideal board supply. */
const Supply = (): React.JSX.Element => <>
  <voltagesource name="V1" voltage="3.3V" doNotPlace connections={{ pin1: "net.VCC", pin2: "net.GND" }} />
  <net name="GND" /><net name="VCC" />
</>
/** Original full bottom ground pour. */
const Pour = ({ w, h }: { w: number; h: number }): React.JSX.Element => (
  <copperpour name="GNDPOUR" layer="bottom" connectsTo="net.GND" unbroken
    outline={[{ x: -w / 2, y: h / 2 }, { x: w / 2, y: h / 2 }, { x: w / 2, y: -h / 2 }, { x: -w / 2, y: -h / 2 }]} />
)

/** Original routed differential pair and termination. */
const Board = (): React.JSX.Element => (
  <board width={44} height={12} layers={2} thickness={1.6} fabricatorPreset="jlcpcb_standard" routingDisabled schematicDisabled>
    <chip name="TX" manufacturerPartNumber="SN65HVD72D" footprint="soic8" pinLabels={HVD}
      pcbX={-15} pcbY={0} connections={{ VCC: "net.VCC", GND: "net.GND" }} />
    <chip name="RX" manufacturerPartNumber="SN65HVD72D" footprint="soic8" pinLabels={HVD}
      pcbX={15} pcbY={0} connections={{ VCC: "net.VCC", GND: "net.GND" }} />
    <resistor name="RTERM" resistance="120" footprint="0603" pcbX={21} pcbY={0} pcbRotation={90} />
    <Supply />
    <Route name="BUS_A" from=".TX > .A" to=".RX > .A" origin={[-15, 0]} width={0.25}
      points={[{ x: -10, y: -0.635 }, { x: -10, y: -3 }, { x: 19, y: -3 }, { x: 19, y: -0.635 }]} />
    <Route name="BUS_B" from=".TX > .B" to=".RX > .B" origin={[-15, 0]} width={0.25}
      points={[{ x: -10, y: 0.635 }, { x: -10, y: 3 }, { x: 19, y: 3 }, { x: 19, y: 0.635 }]} />
    <trace from=".RX > .A" to=".RTERM > .pin1" thickness={0.25} pcbPath={[".RX > .A", ".RTERM > .pin1"]} />
    <trace from=".RX > .B" to=".RTERM > .pin2" thickness={0.25} pcbPath={[".RX > .B", ".RTERM > .pin2"]} />
    <GroundVia chip="TX" at={[-12.85, -1.905]} via={[-11.4, -1.905]} />
    <GroundVia chip="RX" at={[17.15, -1.905]} via={[18.2, -1.905]} />
    <Pour w={42} h={10} />
  </board>
)

/** Renders the original RS-485 physical board used for the historical 11.7/4.2 nH comparison. */
export async function makeGapBoard(): Promise<CircuitJson> {
  const circuit = new Circuit()
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
