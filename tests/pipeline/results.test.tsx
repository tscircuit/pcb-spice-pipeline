import React from 'react'
import { simulation } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderSignals } from '../support/signal-render'
import Differential from '../support/unit-differential'
import { Inverter, Reference } from '../support/signal-parts'
import { prepareBlocks, endpointPorts } from '../../src/pipeline/signals'
import { signalResults } from '../../src/pipeline/results'
import type { PreparedResult } from '../../src/pipeline/result'
import { geometryFromCircuitJson, validateCircuitRecords } from '../../src/board'

/** One listed quiet channel beside unlisted routed copper; both remain in extraction. */
function Board(): React.JSX.Element {
  return <board width={18} height={14} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {[0, 1].map(i => <React.Fragment key={i}>
      <Inverter name={`TX${i}`} x={-5} y={i} driver />
      <Inverter name={`RX${i}`} x={5} y={i} driver={false} />
      <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.2} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
    </React.Fragment>)}
    <Reference />
    <simulation.pcbtransientchannelsimulation bitRate="20Mbps">
      <simulation.pcbchannel name="DATA" driverRef=".TX0 > .Y" receiverRef=".RX0 > .A" pattern="0" />
    </simulation.pcbtransientchannelsimulation>
  </board>
}

test('public RLGC selects listed legs and sums section totals; quiet waveform idle is separately solved', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuit = await renderSignals(<Board />)
  const [prepared] = prepareBlocks(circuit, { 'models/sn74lvc1g04.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`) })
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  assert.equal(geometry.mappings.length, 2)
  const driver = prepared.signals[0].driver
  if (!('source_port_id' in driver)) throw new Error('Expected a single-ended driver')
  const listed = geometry.mappings.findIndex(mapping => mapping.from === driver.source_port_id)
  assert.notEqual(listed, -1)
  const id = prepared.signals[0].simulation_signal_id
  // A synthetic numerical oracle, not a native solve. Metadata unused by this projection is omitted.
  const result = {
    geometry, idleVoltages: [.123, .124],
    experiments: [{ waveform: { rows: [[0, .2, .3], [prepared.duration, .4, .5]] }, probes: [
      { simulationVoltageProbeId: `${id}_0`, column: 1 }, { simulationVoltageProbeId: `${id}_1`, column: 2 },
    ] }],
    matrices: [1, 2].map(scale => {
      const diagonal = geometry.mappings.map((_, i) => i === listed ? scale : 9)
      return { frequencyHz: 1e6,
        R: diagonal.map((value, i) => diagonal.map((_, j) => i === j ? value : .1)),
        L: diagonal.map((value, i) => diagonal.map((_, j) => i === j ? value * 1e-9 : 0)),
        C: diagonal.map((value, i) => diagonal.map((_, j) => i === j ? value * 1e-12 : -1e-13)),
        G: diagonal.map(() => diagonal.map(() => 0)),
      }
    }),
  } as PreparedResult
  const records = signalResults(prepared, result)
  assert.deepEqual(records.map(record => record.type), ['simulation_signal_waveform', 'simulation_signal_waveform', 'simulation_signal_integrity_rlgc'])
  const waves = records.filter(record => record.type === 'simulation_signal_waveform')
  assert.deepEqual(waves.map(record => [record.source_port_id, record.idle_voltage_v]), [[endpointPorts(prepared.signals[0].receivers[0])[0], .123], [driver.source_port_id, .124]])
  assert.ok(waves.every(record => !('end' in record)))
  assert.deepEqual(waves[0].timestamps_s, [0, prepared.duration])
  const rlgc = records.find(record => record.type === 'simulation_signal_integrity_rlgc')!
  assert.deepEqual(rlgc.conductors, [{ simulation_signal_id: id, source_port_id: driver.source_port_id }])
  assert.deepEqual(rlgc.matrices[0].r_ohm, [[3]])
  assert.throws(() => validateCircuitRecords([...prepared.signals, { ...rlgc, conductors: [{ simulation_signal_id: id, source_port_id: 'wrong' }] }]), /every driver port/)
  assert.ok(Math.abs(rlgc.matrices[0].l_h[0][0] - 3e-9) < 1e-23)
  assert.ok(Math.abs(rlgc.matrices[0].c_f[0][0] - 3e-12) < 1e-26)
  assert.throws(() => validateCircuitRecords([...prepared.signals, { ...waves[0], idle_voltage_v: undefined }]), /idle_voltage_v/)
  const switching = { ...prepared.signals[0], pattern: '01' }
  assert.throws(() => validateCircuitRecords([switching, waves[0]]), /idle_voltage_v/)
  const switchingWaves = signalResults({ ...prepared, signals: [switching] }, result).filter(record => record.type === 'simulation_signal_waveform')
  assert.equal(switchingWaves.length, 1)
  assert.ok(!('idle_voltage_v' in switchingWaves[0]))
  delete result.idleVoltages
  assert.throws(() => signalResults(prepared, result), /no undisturbed idle/)
})


test('differential RLGC identifies both physical driver ports without leg labels', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const [prepared] = prepareBlocks(await renderSignals(<Differential />), { 'models/sn65hvd72.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`) })
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  const id = prepared.signals[0].simulation_signal_id
  // Synthetic matrix projection over a real TSX board; no native execution.
  const result = { geometry, experiments: [{ waveform: { rows: [[0, 0], [prepared.duration, 1]] }, probes: [{ simulationVoltageProbeId: `${id}_0`, column: 1 }] }],
    matrices: [{ frequencyHz: 1e6, ...Object.fromEntries(['R', 'L', 'C', 'G'].map(field => [field, geometry.mappings.map((_, i) => geometry.mappings.map((_, j) => field !== 'G' && i === j ? 1e-12 : 0))])) }],
  } as PreparedResult
  const records = signalResults(prepared, result)
  const rlgc = records.find(record => record.type === 'simulation_signal_integrity_rlgc')!
  assert.deepEqual(rlgc.conductors.map(conductor => conductor.source_port_id).sort(), endpointPorts(prepared.signals[0].driver).sort())
  assert.ok(rlgc.conductors.every(conductor => !('leg' in conductor)))
  const waveform = records.find(record => record.type === 'simulation_signal_waveform')!
  assert.equal(waveform.source_port_id, endpointPorts(prepared.signals[0].receivers[0])[0])
  assert.ok(!('idle_voltage_v' in waveform))
})
