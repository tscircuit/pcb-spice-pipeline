import React from 'react'
import { simulation } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderSignals } from '../support/signal-render'
import { Inverter, Reference } from '../support/signal-parts'
import { prepareBlocks } from '../../src/pipeline/signals'
import { signalResults } from '../../src/pipeline/results'
import type { PreparedResult } from '../../src/pipeline/result'
import { geometryFromCircuitJson } from '../../src/board'

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
      <simulation.pcbchannel name="DATA" driverRef=".TX0 > .Y" receiverRef=".RX0 > .A" quiet="low" />
    </simulation.pcbtransientchannelsimulation>
  </board>
}

test('public RLGC selects listed legs and sums section totals; quiet waveform idle is separately solved', { skip: !process.env.IBIS_MODEL_DIR }, async () => {
  const circuit = await renderSignals(<Board />)
  const [prepared] = prepareBlocks(circuit, { 'models/sn74lvc1g04.ibs': await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`) })
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  assert.equal(geometry.mappings.length, 2)
  const id = prepared.signals[0].simulation_signal_id
  // A synthetic numerical oracle, not a native solve. Metadata unused by this projection is omitted.
  const result = {
    geometry, idleVoltages: [.123, .124],
    experiments: [{ waveform: { rows: [[0, .2, .3], [prepared.duration, .4, .5]] }, probes: [
      { simulationVoltageProbeId: `${id}_0`, column: 1 }, { simulationVoltageProbeId: `${id}_1`, column: 2 },
    ] }],
    matrices: [1, 2].map(scale => ({ frequencyHz: 1e6, R: [[scale, .1], [.1, 9]], L: [[scale * 1e-9, 0], [0, 9e-9]], C: [[scale * 1e-12, -1e-13], [-1e-13, 9e-12]], G: [[0, 0], [0, 0]] })),
  } as PreparedResult
  const records = signalResults(prepared, result)
  assert.deepEqual(records.map(record => record.type), ['simulation_signal_waveform', 'simulation_signal_waveform', 'simulation_signal_integrity_rlgc'])
  const waves = records.filter(record => record.type === 'simulation_signal_waveform')
  assert.deepEqual(waves.map(record => [record.end, record.idle_voltage_v]), [['far', .123], ['near', .124]])
  assert.deepEqual(waves[0].timestamps_s, [0, prepared.duration])
  const rlgc = records.find(record => record.type === 'simulation_signal_integrity_rlgc')!
  assert.deepEqual(rlgc.conductors, [{ simulation_signal_id: id, leg: 'single' }])
  assert.deepEqual(rlgc.matrices[0].r_ohm, [[3]])
  assert.ok(Math.abs(rlgc.matrices[0].l_h[0][0] - 3e-9) < 1e-23)
  assert.deepEqual(rlgc.matrices[0].c_f, [[3e-12]])
  delete result.idleVoltages
  assert.throws(() => signalResults(prepared, result), /no undisturbed idle/)
})
