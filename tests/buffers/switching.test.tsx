import React from 'react'
import { Circuit, simulation } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { convertPackaged } from '../../src/buffers/package'
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
      stimuli: { [pinMap['1']]: { type: 'bits', unitInterval: '1.25ns', startTime: '0ns', initialState: 0, pattern: { type: 'bits', bits: '10', repeat: true } } } },
  }
  const converted = convertPackaged(new TextEncoder().encode(source), input)
  assert.match(converted.source, /VKU0 .*PWL/)
  assert.match(converted.source, /VKD0 .*PWL/)
  assert.equal(converted.sourceSha256?.length, 64)
})
