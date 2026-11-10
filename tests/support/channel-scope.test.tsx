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
function Board({ unrelatedY = 20, neighbour = false }: { unrelatedY?: number; neighbour?: boolean }): React.JSX.Element {
  return <board width={24} height={60} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    <Inverter name="TX" x={-5} y={0} driver /><Inverter name="RX" x={5} y={0} driver={false} />
    <Reference />
    {neighbour && <>
      <Inverter name="QUIET_TX" x={-5} y={.8} driver /><Inverter name="QUIET_RX" x={5} y={.8} driver={false} />
      <trace from=".QUIET_TX > .Y" to=".QUIET_RX > .A" width={.2} pcbPath={['.QUIET_TX > .Y', '.QUIET_RX > .A']} />
    </>}
    <trace from=".TX > .Y" to=".RX > .A" width={.2} pcbPath={['.TX > .Y', '.RX > .A']} />
    <chip name="UNRELATED" pcbY={unrelatedY} pinLabels={{ pin1: 'A', pin2: 'B', pin3: 'C' }} footprint={<footprint>
      {[1, 2, 3].map(pin => <React.Fragment key={pin}><smtpad portHints={[`pin${pin}`]} pcbX={pin} pcbY={0} width={.3} height={.3} shape="rect" /></React.Fragment>)}
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
  assert.equal(block.settings.copperScope?.omitted.traces, 2)
  const near = prepareBlocks(await renderSignals(<Board neighbour />), sources)[0]
  assert.equal(near.settings.lanes.length, 2, 'nearby quiet conductor is retained')
  const quiet = [...near.pins.values()].find(pin => pin.buffer.type === 'output' && !near.signals.some(signal => 'source_port_id' in signal.driver && signal.driver.source_port_id === pin.port))!
  assert.ok(near.circuit.some(record => record.type === 'simulation_digital_stimulus' && record.source_port_id === quiet.port && record.transmission_pattern.bits === '0'))
  assert.equal(geometryFromCircuitJson(near.circuit, near.settings).mappings.length, 2)
  const nearbyBranch = await renderSignals(<Board unrelatedY={.5} />)
  assert.throws(() => prepareBlocks(nearbyBranch, sources), /branched routed graphs are not implemented yet/)
})
