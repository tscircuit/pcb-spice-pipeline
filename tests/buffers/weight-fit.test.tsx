import React from 'react'
import { Circuit, simulation } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, parseIbis, switchingWeights } from '@tscircuit/ibis-to-spice'
import { fitWeights, reduceWeights } from '../../src/buffers/weight-fit'

// Original synthetic data: two independently sampled fixtures with a slope
// discontinuity and near-coincident knots. No vendor waveform is copied.
const source = `[IBIS Ver] 4.2
[Component] fixture
[Manufacturer] Test
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
1 DQ driver
2 VDD POWER
3 VSS GND
[Model] driver
Model_type I/O
Polarity Non-Inverting
C_comp 10p 5p 15p
[Voltage Range] 1.5 1.4 1.6
[Pullup]
-1.5 .03 .027 .033
0 0 0 0
3 -.06 -.054 -.066
[Pulldown]
-1.5 -.03 -.027 -.033
0 0 0 0
3 .06 .054 .066
[Ramp]
dV/dt_r .45/.24n .45/.24n .45/.24n
dV/dt_f .45/.24n .45/.24n .45/.24n
${[0, 1.5].map((voltage, index) => `[Rising Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n` +
  [0, .2, .3999 + index * .0001, .4 + index * .0001, .6, .8, 1].map(time => {
    const value = voltage / 2 + .75 * Math.min(1, Math.max(0, (time - .4) / .2))
    return `${time}n ${value} ${value * .9} ${value * 1.1}`
  }).join('\n')).join('\n')}
[End]`

test('TSX independent fixture grids reproduce derivative noise without singular fixtures', async () => {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(source) } })
  circuit.add(<board width={10} height={5} routingDisabled schematicDisabled>
    <chip name="U1" pinLabels={{ 1: 'DQ', 2: 'VDD', 3: 'VSS' }} footprint="sot23" />
    <pcbnotetext text="Independent V-T grids: 0.1 ps cluster" pcbX={0} pcbY={2} />
    <simulation.ibismodel componentRef=".U1" ibisModelAsset={{ project_relative_path: 'fixture.ibs', url: './fixture.ibs', mimetype: 'text/plain' }}
      ibisComponentName="fixture" ibisPinNameToPortLabel={{ 1: 'DQ', 2: 'VDD', 3: 'VSS' }} />
  </board>)
  await circuit.renderUntilSettled()
  assert.ok(circuit.getCircuitJson().some(row => row.type === 'simulation_ibis_model'))
  const buffer = parseIbis(source).getBuffer('driver')
  const saved = structuredClone(buffer)
  const original = switchingWeights(buffer, 'typical', 'rising')
  const fitted = fitWeights(buffer, 'typical', 'rising', { windowSeconds: 10e-12, coefficientTolerance: .001 })
  assert.ok(original.some((row, i) => i > 0 && row[0] - original[i - 1][0] < .11e-12 && Math.abs(row[1] - original[i - 1][1]) > .1))
  assert.ok(fitted.every((row, i) => i === 0 || row[0] - fitted[i - 1][0] >= 4.9e-12))
  assert.deepEqual(buffer, saved)
  assert.equal(fitted[0][0], 0)
  assert.equal(fitted.at(-1)![0], 1e-9)
  assert.notDeepEqual(fitted, fitWeights(buffer, 'minimum', 'rising', { windowSeconds: 10e-12, coefficientTolerance: .001 }))
  assert.ok(fitted.some(row => row[1] < 0 || row[2] < 0), 'do not impose unjustified 0..1 bounds')
  assert.throws(() => fitWeights(buffer, 'typical', 'falling', { windowSeconds: 1e-11, coefficientTolerance: .001 }), { code: 'unsupported_waveforms' })
  const singular = { ...buffer, waveforms: [buffer.waveforms[0], buffer.waveforms[0]] }
  assert.throws(() => fitWeights(singular, 'typical', 'rising', { windowSeconds: 1e-11, coefficientTolerance: .001 }), { code: 'singular_waveforms' })
  for (const windowSeconds of [0, -1, NaN, Infinity])
    assert.throws(() => fitWeights(buffer, 'typical', 'rising', { windowSeconds, coefficientTolerance: .001 }), { code: 'invalid_options' })
  assert.throws(() => fitWeights(buffer, 'typical', 'rising', { windowSeconds: 1e-16, coefficientTolerance: .001 }), { code: 'stimulus_too_long' })
})

test('joint reduction bounds both PWL columns throughout every segment and preserves endpoints', () => {
  const rows: Array<[number, number, number]> = Array.from({ length: 201 }, (_, i) => [i / 200, Math.sin(i / 50), Math.cos(i / 60)])
  const reduced = reduceWeights(rows, .001)
  assert.ok(reduced.length < rows.length / 2)
  for (const column of [1, 2]) {
    const before = rows.map(row => [row[0], row[column]] as [number, number])
    const after = reduced.map(row => [row[0], row[column]] as [number, number])
    for (let i = 0; i <= 10000; i++)
      assert.ok(Math.abs(interpolate(before, i / 10000) - interpolate(after, i / 10000)) <= .001 + 1e-14)
  }
  assert.deepEqual(reduced[0], rows[0])
  assert.deepEqual(reduced.at(-1), rows.at(-1))
  assert.throws(() => reduceWeights(rows, NaN), { code: 'invalid_options' })
})
