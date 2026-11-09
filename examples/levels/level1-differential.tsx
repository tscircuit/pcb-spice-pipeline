// LEVEL 1 (differential): one differential signal. Still ONE signal.
import { sn65hvd72, transceiverPins } from "./parts"

export default () => (
  <board width="60mm" height="20mm" layers={2} fabricatorPreset="jlcpcb_standard">
    <chip name="TX" manufacturerPartNumber="SN65HVD72D" footprint="soic8" pcbX={-25} pinLabels={transceiverPins} />
    <chip name="RX" manufacturerPartNumber="SN65HVD72D" footprint="soic8" pcbX={20} pinLabels={transceiverPins} />
    <ibismodel componentRef=".TX" {...sn65hvd72} />
    <ibismodel componentRef=".RX" {...sn65hvd72} />

    <resistor name="RTERM" resistance="120" footprint="0603" pcbX={26} />

    <trace from=".TX > .VCC" to="net.VCC" />
    <trace from=".RX > .VCC" to="net.VCC" />
    <trace from=".TX > .GND" to="net.GND" />
    <trace from=".RX > .GND" to="net.GND" />

    <trace from=".TX > .A" to=".RX > .A" />
    <trace from=".TX > .B" to=".RX > .B" />
    <trace from=".RX > .A" to=".RTERM > .pin1" />
    <trace from=".RX > .B" to=".RTERM > .pin2" />
    <differentialpair positiveConnection=".TX > .A" negativeConnection=".TX > .B" />
    <copperpour connectsTo="net.GND" layer="bottom" unbroken />

    <signalintegrity bitRate="250kbps">
      <signal
        name="BUS"
        driver={{ p: ".TX > .A", n: ".TX > .B" }}
        receiver={{ p: ".RX > .A", n: ".RX > .B" }}
      />
    </signalintegrity>
  </board>
)
