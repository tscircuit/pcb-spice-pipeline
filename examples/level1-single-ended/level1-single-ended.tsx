import { simulation } from "@tscircuit/core"

// LEVEL 1: one single-ended receiver waveform.
import { Inverter } from "../parts"

export default () => (
  <board width="40mm" height="20mm" layers={2} fabricatorPreset="jlcpcb_standard">
    <Inverter name="TX" pcbX={-15} />
    <Inverter name="RX" pcbX={15} />

    <trace from=".TX > .Y" to=".RX > .A" />

    <copperpour connectsTo="net.GND" layer="bottom" unbroken />

    <simulation.pcbtransientchannelsimulation bitRate="20Mbps">
      <simulation.pcbchannel name="DATA" driverRef=".TX > .Y" receiverRef=".RX > .A" />
    </simulation.pcbtransientchannelsimulation>
  </board>
)
