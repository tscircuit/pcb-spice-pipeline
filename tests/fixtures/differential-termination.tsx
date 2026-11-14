import React from 'react'

/** Core autorouter reproduction: a two-chip pair with a receiver termination tap. No SI or IBIS is needed. */
export default () => <board width={60} height={20} layers={2} schematicDisabled>
  <chip name="TX" footprint="soic8" pcbX={-25} />
  <chip name="RX" footprint="soic8" pcbX={20} />
  <resistor name="RTERM" resistance="120" footprint="0603" pcbX={26} />
  <trace from=".TX > .pin6" to=".RX > .pin6" />
  <trace from=".TX > .pin7" to=".RX > .pin7" />
  <trace from=".RX > .pin6" to=".RTERM > .pin1" />
  <trace from=".RX > .pin7" to=".RTERM > .pin2" />
  <differentialpair positiveConnection=".TX > .pin6" negativeConnection=".TX > .pin7" />
</board>
