import type { SimulationSignal } from '../../src/board'
import React from 'react'
import Single from '../../examples/levels/level1-single-ended'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderSignals } from '../support/signal-render'
import { extendRecording, prepareBlocks, signalBits, endpointPorts } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { Inverter, Reference } from '../../examples/levels/parts'

const modelDir = process.env.IBIS_MODEL_DIR
/** Real vendor bytes, never an invented model. */
const sources = async (): Promise<Record<string, Uint8Array>> => ({ 'models/sn74lvc1g04.ibs': await readFile(`${modelDir}/sn74lvc1g04.ibs`) })
/** Regression boards stay ordinary TSX, including the deliberately incomplete route after RS. */
function Board({ missing = false, via = false, branch = false, sameEnd = false, unlisted = false }: { missing?: boolean; via?: boolean; branch?: boolean; sameEnd?: boolean; unlisted?: boolean }): React.JSX.Element {
  return <board width={18} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    <Inverter name="TX" x={-5} y={0} driver /><Inverter name="RX" x={5} y={0} driver={false} groundX={sameEnd ? -10 : 0} />
    <Reference />
    {missing ? <>
      <resistor name="RS" resistance="33" pcbX={0} footprint={<footprint>
        <smtpad portHints={['pin1']} pcbX={-.5} pcbY={0} width={.3} height={.3} shape="rect" />
        <smtpad portHints={['pin2']} pcbX={.5} pcbY={0} width={.3} height={.3} shape="rect" />
      </footprint>} />
      <trace from=".TX > .Y" to=".RS > .pin1" width={.2} pcbPath={['.TX > .Y', '.RS > .pin1']} />
      <trace from=".RS > .pin2" to=".RX > .A" />
    </> : <trace from=".TX > .Y" to=".RX > .A" width={.2} pcbPath={['.TX > .Y', ...(via ? [
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0, via: true as const, fromLayer: 'top' as const, toLayer: 'bottom' as const }, { x: 9, y: 0 },
      { x: 9, y: 0, via: true as const, fromLayer: 'bottom' as const, toLayer: 'top' as const },
    ] : []), '.RX > .A']} />}
    {(branch || unlisted) && <>
      <Inverter name="TX1" x={-5} y={1} driver /><Inverter name="RX1" x={5} y={1} driver={false} />
      <trace from={branch ? '.TX > .Y' : '.TX1 > .Y'} to=".RX1 > .A" width={.2} pcbPath={branch ? ['.TX > .Y', { x: 5, y: 1 }, '.RX1 > .A'] : ['.TX1 > .Y', '.RX1 > .A']} />
    </>}
    <signalintegrity bitRate="20Mbps">
      <signal name="D81" driver=".TX > .Y" receiver={branch ? ['.RX > .A', '.RX1 > .A'] : '.RX > .A'} />
    </signalintegrity>
  </board>
}

test('full unrouted check reaches the segment after a series passive', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Board missing />, ['pcb_trace_missing_error', 'pcb_port_not_connected_error'])
  const ibis = await sources()
  assert.throws(() => prepareBlocks(circuit, ibis), /is not routed between/)
})

test('same-end return contacts keep the original 3D routed copper', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Board sameEnd />)
  const prepared = prepareBlocks(circuit, await sources())[0]
  assert.ok(geometryFromCircuitJson(prepared.circuit, prepared.settings).cells[0].routedCopper)
})

test('routed receiver arrays get the RFC not-implemented diagnostic', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Board branch />)
  const ibis = await sources()
  assert.throws(() => prepareBlocks(circuit, ibis), /branched routed graphs are not implemented yet/)
})

test('unlisted output-only models drive a steady physical low; D81 receives a legal planned seed', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Board unlisted />)
  const prepared = prepareBlocks(circuit, await sources())[0]
  assert.equal(prepared.signals[0].seed, 127)
  const extra = [...prepared.pins.values()].find(pin => pin.buffer.type === 'output' && pin.port !== ('source_port_id' in prepared.signals[0].driver ? prepared.signals[0].driver.source_port_id : ''))!
  const state = prepared.circuit.find(r => r.type === 'simulation_ibis_pin_state' && r.source_port_id === extra.port)
  assert.equal(state?.type === 'simulation_ibis_pin_state' && state.is_output_enabled, true)
  const stimulus = prepared.circuit.find(r => r.type === 'simulation_digital_stimulus' && r.source_port_id === extra.port)
  assert.equal(stimulus?.type === 'simulation_digital_stimulus' && stimulus.transmission_pattern.bits, '0')
})

test('TSX vias use core preset plating and respect an explicit stackup thickness', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Board via />)
  const ibis = await sources()
  const stack = circuit.find(record => record.type === 'pcb_stackup')!
  if (stack.type !== 'pcb_stackup') throw new Error('Missing stackup')
  assert.equal(stack.plated_hole_copper_thickness, .018)
  assert.equal(prepareBlocks(circuit, ibis)[0].settings.viaPlatingMm, .018)
  delete stack.plated_hole_copper_thickness
  assert.throws(() => prepareBlocks(circuit, ibis), /pcb_stackup must specify plated_hole_copper_thickness/)
  stack.plated_hole_copper_thickness = .025
  const [prepared] = prepareBlocks(circuit, ibis)
  assert.equal(prepared.settings.viaPlatingMm, .025)
  assert.ok(geometryFromCircuitJson(prepared.circuit, prepared.settings).cells[0].routedCopper)
})

const signal: SimulationSignal = { type: 'simulation_signal', simulation_signal_id: 's', simulation_signal_integrity_id: 'b', name: 'D',
  driver: { kind: 'single', source_port_id: 'a' }, receivers: [{ kind: 'single', source_port_id: 'b' }],
  bit_rate_bps: 1, pattern: 'prbs7', seed: 42, offset_s: 0, probe: 'local', mask: 'ibis' }

test('PRBS7 has a complete stable 127-bit period with decorrelated seeds', () => {
  const a = signalBits(signal, 127)
  assert.equal(a.length, 127)
  assert.equal(a.split('1').length - 1, 64)
  assert.equal(a, signalBits(signal, 1000))
  assert.notEqual(a, signalBits({ ...signal, seed: 41 }, 127))
  for (const pattern of ['prbs15', 'prbs31']) assert.equal(signalBits({ ...signal, pattern }, 20).length, 21)
  assert.throws(() => signalBits({ ...signal, seed: 0 }, 20), /integer in 1..127/)
  assert.throws(() => signalBits({ ...signal, seed: 0, quiet: 'high' }, 20), /integer in 1..127/)
})

test('literal, clock and each explicit quiet state', () => {
  assert.equal(signalBits({ ...signal, pattern: '0011' }, 2), '0011')
  assert.equal(signalBits({ ...signal, pattern: 'clock' }, 10), '01')
  assert.equal(signalBits({ ...signal, quiet: 'high' }, 10), '1')
  assert.equal(signalBits({ ...signal, quiet: 'low' }, 10), '0')
  assert.throws(() => signalBits({ ...signal, pattern: '10x' }, 10), /pattern/)
  assert.deepEqual(endpointPorts({ kind: 'differential', p_source_port_id: 'p', n_source_port_id: 'n' }), ['p', 'n'])
})

test('the removed modeling API cannot supply a test or synthesize a block', () => {
  assert.deepEqual(prepareBlocks([], {}), [])
})

test('automatic extension regenerates PRBS coverage and preserves duration provenance', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Single />)
  const block = circuit.find(record => record.type === 'simulation_signal_integrity')!
  if (block.type !== 'simulation_signal_integrity') throw new Error('Missing block')
  delete block.duration_s
  const [prepared] = prepareBlocks(circuit, { 'models/sn74lvc1g04.ibs': await readFile(`${modelDir}/sn74lvc1g04.ibs`) })
  const initial = prepared.duration
  extendRecording(prepared)
  assert.ok(prepared.duration > initial)
  assert.equal(block.duration_s, undefined)
  const transient = prepared.circuit.find(record => record.type === 'simulation_experiment')!
  assert.equal(transient.type === 'simulation_experiment' && transient.end_time_ms, prepared.duration * 1000)
  block.duration_s = initial
  assert.throws(() => extendRecording(prepared), /explicit/)
})
