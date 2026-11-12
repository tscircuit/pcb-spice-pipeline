import React from 'react'
import { Circuit, simulation } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { convertIbisModelToSpice, interpolate, logicalBitSchedule, parseIbis, switchingWeights } from '@tscircuit/ibis-to-spice'
import { convertPackaged } from '../../src/buffers/package'
import { createNativeSolver } from '../../src/adapters'
import { sha256 } from '../../src/kernel'
import type { ModelRunDefinition } from '../../src/buffers'

// Original two-fixture CMOS model: the edge finishes at 0.8 ns, but the
// acquisition includes a flat tail to 4 ns. No vendor data is copied here.
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
C_comp 1p 1p 1p
[Voltage Range] 1.5 1.5 1.5
[Pullup]
-1.5 .03 .03 .03
0 0 0 0
3 -.06 -.06 -.06
[Pulldown]
-1.5 -.03 -.03 -.03
0 0 0 0
3 .06 .06 .06
[Ramp]
dV/dt_r .45/.24n .45/.24n .45/.24n
dV/dt_f .45/.24n .45/.24n .45/.24n
${(['rising', 'falling'] as const).flatMap(kind => [0, 1.5].map(voltage =>
  `[${kind === 'rising' ? 'Rising' : 'Falling'} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n` +
  [[0, 0], [.2, 0], [.4, .5], [.6, 1], [.8, 1], [1, 1], [2, 1], [4, 1]].map(([time, fraction]) => {
    const value = voltage / 2 + .75 * (kind === 'rising' ? fraction : 1 - fraction)
    return `${time}n ${value} ${value} ${value}`
  }).join('\n'))).join('\n')}
[End]`

test('TSX 800 Mbps driver accepts a settled acquisition tail longer than its 1.25 ns bit', async () => {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(source) } })
  circuit.add(<board width={10} height={5} routingDisabled schematicDisabled>
    <chip name="U1" pinLabels={{ 1: 'DQ', 2: 'VDD', 3: 'VSS' }} footprint="sot23" />
    <pcbnotetext text="800 Mbps: 0.8 ns edge, 4 ns acquisition" pcbX={0} pcbY={2} />
    <simulation.ibismodel componentRef=".U1" ibisModelAsset={{ project_relative_path: 'fixture.ibs', url: './fixture.ibs', mimetype: 'text/plain' }}
      ibisComponentName="fixture" ibisPinNameToPortLabel={{ 1: 'DQ', 2: 'VDD', 3: 'VSS' }} />
  </board>)
  await circuit.renderUntilSettled()
  const model = circuit.getCircuitJson().find(record => record.type === 'simulation_ibis_model')!
  if (model.type !== 'simulation_ibis_model') throw new Error('Missing TSX IBIS model')
  const pinMap = model.ibis_pin_name_to_source_port_id
  const input: ModelRunDefinition = {
    definition: { source: { content: source }, component: 'fixture', pinMap, corner: 'typical', packagePolicy: 'vendor' },
    run: { duration: '5ns', pinStates: { [pinMap['1']]: { mode: 'output', enabled: true } },
      stimuli: { [pinMap['1']]: { unitInterval: '1.25ns', startTime: '0ns', initialState: 0, pattern: { type: 'bits', bits: '10', repeat: true } } } },
  }
  const saved = structuredClone(input)
  const converted = convertPackaged(new TextEncoder().encode(source), input)
  assert.throws(() => convertIbisModelToSpice(source, { ...input.definition, packagePolicy: 'omit' }, input.run), { code: 'overlapping_edges' })
  assert.match(converted.source, /VKU0 .*PWL/)
  assert.match(converted.source, /VKD0 .*PWL/)
  assert.equal(converted.sourceSha256, sha256(source))
  assert.deepEqual(input, saved)
  assert.deepEqual(converted.metadata.switchingTails?.map(tail => [tail.edge, tail.originalDurationSeconds]), [['rising', 4e-9], ['falling', 4e-9]])
  for (const tail of converted.metadata.switchingTails!) {
    assert.ok(Math.abs(tail.retainedDurationSeconds - .8e-9) < 1e-20)
    assert.equal(tail.coefficientTolerance, .01)
    assert.ok(tail.maxCoefficientDeviation <= .01)
    for (const fixture of tail.fixtures) assert.ok(fixture.maxDeviationVolts <= fixture.toleranceVolts)
  }
  assert.ok(converted.warnings.some(warning => warning.includes('inactive tails truncated')))
  /** Alter the explicit run without altering caller-owned inputs. */
  function run(bits: string, interval: string, duration: string = '5ns'): ModelRunDefinition {
    const next = structuredClone(input)
    next.run.duration = duration
    next.run.stimuli[pinMap['1']].unitInterval = interval
    next.run.stimuli[pinMap['1']].pattern.bits = bits
    return next
  }
  /** Run an original inline model through the same package and switching boundary. */
  function convert(next: ModelRunDefinition, text: string = source): ReturnType<typeof convertPackaged> {
    return convertPackaged(new TextEncoder().encode(text), { ...next, definition: { ...next.definition, source: { content: text } } })
  }
  /** Recover emitted PWL knots so assertions exercise the electrical artifact. */
  function points(text: string, label: string): Array<[number, number]> {
    const values = new RegExp(`^V${label}0 .*PWL\\((.*)\\)$`, 'm').exec(text)![1].split(/\s+/).map(Number)
    return values.filter((_, i) => i % 2 === 0).map((value, i) => [value, values[i * 2 + 1]])
  }
  const knots = points(converted.source, 'KU')
  assert.ok(knots.every((row, i) => i === 0 || row[0] > knots[i - 1][0]))
  assert.equal(knots.at(-1)![0], 5e-9)
  assert.ok(interpolate(knots, 1e-9) > .99)
  assert.ok(interpolate(knots, 2.25e-9) < .01)
  // A femtosecond hold before each table forced the routed DDR deck below ngspice's minimum step.
  const table = switchingWeights(parseIbis(source).getBuffer('driver'), 'typical', 'rising')
  const resolution = Math.min(...table.slice(1).map((row, i) => row[0] - table[i][0]))
  for (const label of ['KU', 'KD']) {
    const column = points(converted.source, label)
    assert.ok(column.every((row, i) => i === 0 || row[0] - column[i - 1][0] >= resolution * (1 - 1e-9)), `${label} has no stitch interval finer than the IBIS table`)
    const edge = column.findIndex(row => Math.abs(row[0] - 1.25e-9) < 1e-18)
    assert.equal(column[edge][1], column[edge - 1][1], `${label} falling edge starts from the held coefficient`)
  }
  const repeated = convert(run('1111100000', '0.25ns'))
  assert.deepEqual(points(repeated.source, 'KU'), knots, 'identical bits never retrigger an edge')
  assert.throws(() => convert(run('10', '0.25ns')), /has not settled before the next edge/)
  const late = source.replace('2n 0.75 0.75 0.75', '2n 0.5 0.5 0.5')
  assert.throws(() => convert(input, late), /has not settled before the next edge/, 'a late excursion invalidates an earlier plateau')
  const mismatch = source.replace('4n 0.75 0.75 0.75', '4n 0.73 0.73 0.73')
  assert.throws(() => convert(input, mismatch), /has not settled before the next edge/, 'flat fixture endpoints cannot hide nonsteady coefficients')
  // A 100 pF die has a 2.5 ns fixture time constant. Its coefficients are
  // already steady, but the measured voltage is still changing at 1.25 ns.
  const slowFixture = source.slice(0, source.indexOf('[Rising Waveform]')).replace('C_comp 1p 1p 1p', 'C_comp 100p 100p 100p') +
    (['rising', 'falling'] as const).flatMap(edge => [0, 1.5].map(voltage =>
      `[${edge === 'rising' ? 'Rising' : 'Falling'} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n` +
      Array.from({ length: 801 }, (_, i) => {
        const time = i * .025
        const fraction = Math.exp(-time / 2.5)
        const value = voltage / 2 + .75 * (edge === 'rising' ? 1 - fraction : fraction)
        return `${time}n ${value} ${value} ${value}`
      }).join('\n'))).join('\n') + '\n[End]'
  assert.ok(switchingWeights(parseIbis(slowFixture).getBuffer('driver'), 'typical', 'rising').every(row => Math.abs(row[1] - 1) <= .01 && Math.abs(row[2]) <= .01))
  assert.throws(() => convert(input, slowFixture), /has not settled before the next edge/, 'coefficient settling alone does not authorize voltage tail truncation')
  const slow = source.replace('2n 0.75 0.75 0.75', '2n 0.75 0.5 0.75')
  assert.doesNotThrow(() => convert(input, slow))
  assert.throws(() => convert({ ...input, definition: { ...input.definition, corner: 'minimum' } }, slow), /has not settled/)
  const finite = run('1', '1.25ns', '0.5ns')
  const original = convertIbisModelToSpice(source, { ...finite.definition, packagePolicy: 'omit' }, finite.run)
  assert.deepEqual(points(convert(finite).source, 'KU'), points(original.source, 'KU'), 'finite window interpolates inside the measured transition')
  const idle = run('0', '1.25ns')
  assert.equal(convert(idle).metadata.switchingTails, undefined)
  assert.doesNotThrow(() => convert(idle, source.replaceAll('[Rising Waveform]', '[Falling Waveform]')))
  assert.throws(() => convert(run('2', '1.25ns')), { code: 'invalid_pattern' })
  const inverted = run('10', '1.25ns')
  inverted.run.stimuli[pinMap['1']].inverted = true
  inverted.run.stimuli[pinMap['1']].startTime = '0.625ns'
  const shifted = convert(inverted)
  assert.equal(shifted.metadata.pins[0].stimulusHash, logicalBitSchedule(inverted.run.stimuli[pinMap['1']], '5ns').sha256)
  assert.equal(points(shifted.source, 'KU')[0][1], 1)
  assert.ok(interpolate(points(shifted.source, 'KU'), .6e-9) > .99)
  const long = run('10', '5ns', '10ns')
  assert.equal(convert(long).metadata.switchingTails, undefined)
  const upstream = points(convertIbisModelToSpice(source, { ...long.definition, packagePolicy: 'omit' }, long.run).source, 'KU')
  assert.deepEqual(points(convert(long).source, 'KU'), upstream.filter((row, i) => !(upstream[i + 1]?.[0] - row[0] < resolution / 2)), 'upstream knots without its femtosecond hold')
  assert.doesNotThrow(() => convert(run('10', '4ns', '8ns')), 'a settled table ending exactly at the next trigger is valid')
  const inversePolarity = source.replace('Polarity Non-Inverting', 'Polarity Inverting')
  const polarity = convert(run('10', '1.25ns'), inversePolarity)
  assert.equal(polarity.metadata.pins[0].stimulusHash, logicalBitSchedule(input.run.stimuli[pinMap['1']], '5ns', 'inverting').sha256)
  assert.equal(points(polarity.source, 'KU')[0][1], 1)

  if (!process.env.SI_TEST_SWITCHING_NGSPICE) return
  const solve = createNativeSolver({ timeoutMs: 10000, tools: { ngspice: process.env.NGSPICE_BIN ?? 'ngspice' } })
  const traces: Array<Array<[number, number]>> = []
  for (const [model, duration] of [[converted, '5n'], [convert(long), '10n']] as const) {
    const nodes = Object.values(model.spicePinMapping).map(port => port === pinMap['1'] ? 'out' : port === pinMap['2'] ? 'vdd' : 'vss')
    const name = /^\.subckt (\S+)/m.exec(model.source)![1]
    const deck = `Buffer-only settled tail oracle\n${model.source}\nXU ${nodes.join(' ')} ${name}\nRload out vss 50\n.control\nset wr_singlescale\nset wr_vecnames\ntran 2p ${duration}\nwrdata waveform.dat v(out)\nquit\n.endc\n.end\n`
    const output = await solve({ solver: 'ngspice', files: { 'buffer.cir': deck }, args: ['-n', '-b', 'buffer.cir'], outputFiles: ['waveform.dat'] })
    assert.doesNotMatch(output.stdout + output.stderr, /error|fatal|aborted|timestep too small/i)
    traces.push(output.files['waveform.dat'].trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number) as [number, number]))
  }
  for (const time of [.1e-9, .3e-9, .5e-9, .7e-9, 1e-9]) {
    assert.ok(Math.abs(interpolate(traces[0], time) - interpolate(traces[1], time)) < .002)
    assert.ok(Math.abs(interpolate(traces[0], 1.25e-9 + time) - interpolate(traces[1], 5e-9 + time)) < .002, 'short-bit and full-acquisition falling responses agree within 2 mV')
  }
})
