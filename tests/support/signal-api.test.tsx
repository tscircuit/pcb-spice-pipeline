import { simulation } from '@tscircuit/core'
import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderSignals } from './signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { admitBuffers, compileBuffers } from '../../src/buffers'
import { generalDeclarations, modelRunDefinition } from '../../src/simulation'
import { rootScope } from '../../src/kernel'
import Single from './unit-single-ended'
import Differential from './unit-differential'
import { Inverter, Reference } from './signal-parts'

const modelDir = process.env.IBIS_MODEL_DIR
/** Read actual vendor bytes only; no synthetic IBIS fallback. */
const sources = async (): Promise<Record<string, Uint8Array>> => Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${modelDir}/${file}`)])))

/** More than three physical conductors, expressed as real TSX. */
function Four(): React.JSX.Element {
  return <board width={16} height={12} thickness={1.6} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {[0, 1, 2, 3].map(i => <React.Fragment key={i}>
      <Inverter name={`TX${i}`} x={-5} y={i * .4} driver /><Inverter name={`RX${i}`} x={5} y={i * .4} driver={false} />
      <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.2} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
    </React.Fragment>)}
    <Reference />
    <simulation.pcbtransientchannelsimulation name="FOUR" bitRate={20e6} duration={48 / 20e6}>
      {[0, 1, 2, 3].map(i => <simulation.pcbchannel key={i} name={`D${i}`} driverRef={`.TX${i} > .Y`} receiverRef={`.RX${i} > .A`} />)}
    </simulation.pcbtransientchannelsimulation>
  </board>
}

test('Real core renders source records and core-owned stackup for unit boards', async () => {
  for (const Board of [Single, Differential, Four]) {
    const records = await renderSignals(<Board />)
    assert.equal(records.filter(r => r.type === 'pcb_stackup').length, 1)
    assert.ok(records.some(r => r.type === 'simulation_signal'))
    assert.ok(!records.some(r => ['simulation_experiment', 'simulation_voltage_probe', 'simulation_digital_stimulus'].includes(r.type)))
  }
})

test('four-conductor derivation and geometry are invariant under signal record order', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Four />)
  const ibis = await sources()
  const a = prepareBlocks(circuit, ibis)[0]
  const b = prepareBlocks([...circuit.filter(r => r.type !== 'simulation_signal'), ...circuit.filter(r => r.type === 'simulation_signal').reverse()], ibis)[0]
  assert.equal(a.settings.lanes.length, 4)
  assert.deepEqual(a.settings, b.settings)
  assert.deepEqual(geometryFromCircuitJson(a.circuit, a.settings), geometryFromCircuitJson(b.circuit, b.settings))
  const geometry = geometryFromCircuitJson(a.circuit, a.settings)
  assert.equal(geometry.cells[0].conductors.length, 5)
  geometry.cells[0].conductors.slice(0, -1).map(c => c.yM).sort().forEach((value, i) => assert.ok(Math.abs(value - i * .0004) < 1e-15))
})

test('RS485 differential identity and the placed termination are derived from real vendor data and TSX', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Differential />)
  const ibis = await sources()
  const prepared = prepareBlocks(circuit, ibis)[0]
  const receiver = prepared.signals[0].receivers[0]
  assert.ok('p_source_port_id' in receiver)
  if (!('p_source_port_id' in receiver)) return
  const resistor = circuit.filter(r => r.type === 'source_component').find(r => r.name === 'RTERM')!
  assert.ok(prepared.settings.passiveComponents?.some(p => p.sourceComponentId === resistor.source_component_id))
})

test('signal packages and vendor reference evidence remain present; disabled drivers reject output-only buffers', { skip: !modelDir }, async () => {
  const circuit = await renderSignals(<Single />)
  const signal = circuit.find(r => r.type === 'simulation_signal')!
  if (signal.type !== 'simulation_signal') throw new Error('missing signal')
  signal.driver_disabled = true
  const ibis = await sources()
  assert.throws(() => prepareBlocks(circuit, ibis), /has no disabled state/)
  signal.driver_disabled = false
  signal.pattern = '0'
  const prepared = prepareBlocks(circuit, ibis)[0]
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  const declarations = generalDeclarations(prepared.circuit, geometry, prepared.settings)
  const admitted = admitBuffers(declarations.models, ibis, prepared.settings, rootScope('buffers'))
  const compiled = compileBuffers(admitted.value, declarations.plans, modelRunDefinition)[0]
  for (const model of compiled) {
    assert.equal(model.metadata.packagePolicy, 'vendor')
    assert.match(model.source, /RPKG/)
    assert.match(model.source, /LPKG/)
    assert.match(model.source, /CPKG/)
    assert.equal(model.metadata.packageData.mappedPins.filter(p => p.role === 'reference').length, 2)
  }
  assert.ok(compiled[0].metadata.pins.some(p => p.runState.mode === 'output' && p.runState.enabled))
})
