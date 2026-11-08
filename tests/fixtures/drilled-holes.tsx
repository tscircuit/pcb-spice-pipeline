import React from 'react'
import { Circuit } from '@tscircuit/core'
import type { CircuitJson } from 'circuit-json'

/** Actual JSX-produced mechanical hole records, in the crosstalk board's coordinate system. */
export async function drilledHoles(): Promise<CircuitJson> {
  const circuit = new Circuit()
  circuit.add(<board width={40} height={24} routingDisabled schematicDisabled>
    <hole name="MOUNT" diameter={1} pcbX={0} pcbY={8} />
  </board>)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson().filter(r => r.type === 'pcb_hole')
}
