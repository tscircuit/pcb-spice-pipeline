import React from 'react'
import { simulation } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Inverter, Reference } from './signal-parts'
import { renderSignals } from './signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'

/** The unmodelled three-pad copper is physically far from DATA, on the same real board. */
function Board(): React.JSX.Element {
  return <board width={24} height={60} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    <Inverter name="TX" x={-5} y={0} driver /><Inverter name="RX" x={5} y={0} driver={false} />
    <Reference />
    <trace from=".TX > .Y" to=".RX > .A" width={.2} pcbPath={['.TX > .Y', '.RX > .A']} />
    <chip name="UNRELATED" pcbY={20} pinLabels={{ pin1: 'A', pin2: 'B', pin3: 'C' }} footprint={<footprint>
      {[1, 2, 3].map(pin => <smtpad key={pin} portHints={[`pin${pin}`]} pcbX={pin} pcbY={0} width={.3} height={.3} shape="rect" />)}
    </footprint>} />
    <trace path={['.UNRELATED > .A', '.UNRELATED > .B', '.UNRELATED > .C']} width={.2}
      pcbPaths={[[".UNRELATED > .A", ".UNRELATED > .B"], [".UNRELATED > .B", ".UNRELATED > .C"]]} />
    <pcbnotetext text="DATA at y=0; unrelated branched copper at y=20 mm" pcbY={25} pcbX={0} />
    <simulation.pcbtransientchannelsimulation name="SCOPED" bitRate="20Mbps">
      <simulation.pcbchannel name="DATA" driverRef=".TX > .Y" receiverRef=".RX > .A" />
    </simulation.pcbtransientchannelsimulation>
  </board>
}

test('TSX unrelated branched copper cannot reject a selected channel on the full board', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuit = await renderSignals(<Board />)
  const sources = { 'models/sn74lvc1g04.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`) }
  const [block] = prepareBlocks(circuit, sources)
  assert.equal(block.settings.lanes.length, 1)
  assert.equal(geometryFromCircuitJson(block.circuit, block.settings).mappings.length, 1)
})
