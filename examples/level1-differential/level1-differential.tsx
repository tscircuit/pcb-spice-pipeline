import { simulation } from "@tscircuit/core"

// LEVEL 1 (differential): one P−N receiver waveform; no separate leg waveforms.
import { sn65hvd72, transceiverPins } from "../parts"
import { routes } from "./routes"

export default () => (
  <board width="60mm" height="20mm" layers={2} fabricatorPreset="jlcpcb_standard" routeRemaining={false}>
    <chip name="TX" manufacturerPartNumber="SN65HVD72D" footprint="soic8" pcbX={-25} pinLabels={transceiverPins} />
    <chip name="RX" manufacturerPartNumber="SN65HVD72D" footprint="soic8" pcbX={20} pinLabels={transceiverPins} />
    <simulation.ibismodel componentRef=".TX" {...sn65hvd72} />
    <simulation.ibismodel componentRef=".RX" {...sn65hvd72} />

    <resistor name="RTERM" resistance="120" footprint="0603" pcbX={23.8} pcbRotation={90} />

    {/* pdn="ideal" supplies die rails; package parasitics remain. Power copper is omitted. */}
    <via name="GND_TX" pcbX={-21.7} pcbY={-1.905} holeDiameter="0.2mm" outerDiameter="0.4mm" layers={["top", "bottom"]} connectsTo="net.GND" />
    <via name="GND_RX" pcbX={23.1} pcbY={-1.905} holeDiameter="0.2mm" outerDiameter="0.4mm" layers={["top", "bottom"]} connectsTo="net.GND" />
    <trace from=".TX > .GND" to=".GND_TX > .top" connectsTo={[".TX > .GND", ".GND_TX > .top", "net.GND"]} pcbPath={routes.TX_GND} />
    <trace from=".RX > .GND" to=".GND_RX > .top" connectsTo={[".RX > .GND", ".GND_RX > .top", "net.GND"]} pcbPath={routes.RX_GND} />

    <trace from=".TX > .A" to=".RX > .A" width="0.15mm" pcbPath={routes.A} />
    <trace from=".TX > .B" to=".RX > .B" width="0.15mm" pcbPath={routes.B} />
    <trace from=".RX > .A" to=".RTERM > .pin1" width="0.15mm" pcbPath={routes.A_TERM} />
    <trace from=".RX > .B" to=".RTERM > .pin2" width="0.15mm" pcbPath={routes.B_TERM} />
    <differentialpair positiveConnection=".TX > .A" negativeConnection=".TX > .B" />
    <copperpour connectsTo="net.GND" layer="bottom" unbroken />

    <simulation.pcbtransientchannelsimulation bitRate="250kbps">
      <simulation.pcbchannel
        name="BUS"
        driverRef={{ p: ".TX > .A", n: ".TX > .B" }}
        receiverRef={{ p: ".RX > .A", n: ".RX > .B" }}
      />
    </simulation.pcbtransientchannelsimulation>
  </board>
)
