import React from 'react'

/** Minimal real-footprint reproduction: core ends each ground escape route at a via into the plane. */
export default ({ planeScale = 1 }: { planeScale?: number }) => <board width={40 * planeScale} height={20 * planeScale} layers={2} fabricatorPreset="jlcpcb_standard" schematicDisabled>
  {[-15, 15].map((x, i) => <chip key={i} name={i ? 'RX' : 'TX'} pcbX={x} footprint="sot23_5"
    pinLabels={{ pin2: 'A', pin3: 'GND', pin4: 'Y' }} connections={{ GND: 'net.GND' }} />)}
  <trace from=".TX > .Y" to=".RX > .A" />
  <copperpour connectsTo="net.GND" layer="bottom" unbroken />
</board>
