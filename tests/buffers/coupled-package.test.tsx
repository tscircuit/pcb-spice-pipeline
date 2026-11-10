import React from 'react'
import { simulation, Circuit } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { convertPackaged } from '../../src/buffers/package'

// Original synthetic IBIS exercises the package boundary, never substitutes native board evidence.
const source = `[IBIS Ver] 4.2
[Component] fixture
[Manufacturer] Test
[Package Model] coupled
[Package]
R_pkg 99 99 99
L_pkg 99n 99n 99n
C_pkg 99p 99p 99p
[Pin] signal_name model_name R_pin L_pin C_pin
A1 A input 9 9n 9p
B1 B input 8 8n 8p
V1 VDD POWER 7 7n 7p
G1 VSS GND 6 6n 6p
[Model] input
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 1.5 1.5 1.5
[Define Package Model] coupled
[Manufacturer] Test
[OEM] Test
[Description] Original coupled fixture
[Number Of Pins] 4
[Pin Numbers]
B1
G1
A1
V1
[Model Data]
[Resistance Matrix] Full_matrix
[Row] B1
2 .1 .2 0
[Row] G1
3 0 0
[Row] A1
1 0
[Row] V1
4
[Inductance Matrix] Full_matrix
[Row] B1
4n 0 -1n 0
[Row] G1
1n 0 0
[Row] A1
2n 0
[Row] V1
3n
[Capacitance Matrix] Full_matrix
[Row] B1
3p -.2p -.5p 0
[Row] G1
2p -.1p 0
[Row] A1
2p 0
[Row] V1
1p
[End Model Data]
[End Package Model]
[End]`

/** TSX reproduction has real serialized IBIS pin bindings, with no native board solve. */
function Board(): React.JSX.Element {
  return <board width={10} height={10} routingDisabled schematicDisabled>
    <chip name="U1" pinLabels={{ A1: 'A', B1: 'B', V1: 'VDD', G1: 'VSS' }} footprint={<footprint>
      {['A1', 'B1', 'V1', 'G1'].map((pin, i) => <smtpad key={pin} portHints={[pin]} pcbX={i - 1.5} pcbY={0} width={.3} height={.3} shape="rect" />)}
    </footprint>} />
    <simulation.ibismodel componentRef=".U1" ibisModelAsset={{ project_relative_path: 'fixture.ibs', url: './fixture.ibs', mimetype: 'text/plain' }} ibisComponentName="fixture"
      ibisPinNameToPortLabel={{ A1: 'A', B1: 'B', V1: 'VDD', G1: 'VSS' }} />
  </board>
}

test('TSX coupled package replaces scalar values, preserves ideal die rails and realizes signed R/L/C', async () => {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(source) } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  const model = circuit.getCircuitJson().find(record => record.type === 'simulation_ibis_model')!
  if (model.type !== 'simulation_ibis_model') throw new Error('Missing TSX IBIS model')
  const pinMap = model.ibis_pin_name_to_source_port_id
  const input = { definition: { source: { content: source }, component: 'fixture', pinMap, corner: 'typical' as const, packagePolicy: 'vendor' as const },
    run: { duration: '1ns', pinStates: { [pinMap.A1]: { mode: 'input' as const }, [pinMap.B1]: { mode: 'input' as const } }, stimuli: {} } }
  const converted = convertPackaged(new TextEncoder().encode(source), input)
  assert.match(converted.source, /KPKG\d+_\d+ LPKG\d+ LPKG\d+ -0\.353553/)
  assert.match(converted.source, /HPKG/)
  assert.match(converted.source, /CPKG0_1a PAD0 PAD1 2\.5e-13/)
  assert.match(converted.source, /VPDN\d+ DIE\d+ 0 1\.5/)
  assert.match(converted.source, /VPDN\d+ DIE\d+ 0 0/)
  assert.doesNotMatch(converted.source, / 99(?:\s|$)| 9e-9(?:\s|$)/)
  assert.deepEqual(converted.metadata.omissions, [])
  assert.ok(converted.warnings.some(warning => /A1.*resistance.*9.*1/.test(warning)))
  assert.throws(() => convertPackaged(new TextEncoder().encode(source.replace('[Define Package Model] coupled', '[Define Package Model] absent')), { ...input, definition: { ...input.definition, source: { file: 'fixture.ibs' } } }), /missing.*scalar fallback is forbidden/i)
})
