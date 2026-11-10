import React from 'react'
import { simulation, Circuit } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { convertPackaged } from '../../src/buffers/package'
import { coupledPackageElements } from '../../src/buffers/coupled-package'
import { createNativeSolver } from '../../src/adapters'

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
      {['A1', 'B1', 'V1', 'G1'].map((pin, i) => <React.Fragment key={pin}><smtpad portHints={[pin]} pcbX={i - 1.5} pcbY={0} width={.3} height={.3} shape="rect" /></React.Fragment>)}
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
  assert.deepEqual(converted.metadata.packageData.matrices?.pins, ['A1', 'B1', 'V1', 'G1'])
  assert.equal(converted.metadata.packageData.mappedPins.find(pin => pin.physicalPin === 'A1')?.resistanceOhms, 1)
  assert.ok(converted.warnings.some(warning => /A1.*resistance.*9.*1/.test(warning)))
  assert.throws(() => convertPackaged(new TextEncoder().encode(source.replace('[Define Package Model] coupled', '[Define Package Model] absent')), { ...input, definition: { ...input.definition, source: { file: 'fixture.ibs' } } }), /missing.*scalar fallback is forbidden/i)
  if (process.env.SI_TEST_PACKAGE_NGSPICE !== '1') return
  const data = { pins: ['A', 'B'], R: [[1, -.2], [-.2, 2]], L: [[2e-9, 1e-9], [1e-9, 4e-9]], C: [[2e-12, -.5e-12], [-.5e-12, 3e-12]] }
  const elements = coupledPackageElements(data, ['a', 'b'], ['0', '0'], '0')
  const deck = ['Package only AC oracle', ...elements, 'VA a 0 ac 1', 'VB b 0 ac 0', '.control', 'set wr_singlescale', 'set wr_vecnames', 'ac lin 1 1Meg 1Meg', 'wrdata package.dat v(a) v(b) i(VPKGS0) i(VPKGS1) i(VA) i(VB)', 'quit', '.endc', '.end'].join('\n')
  const solve = createNativeSolver({ timeoutMs: 10000, tools: { ngspice: process.env.NGSPICE_BIN ?? '/opt/homebrew/bin/ngspice' } })
  const result = await solve({ solver: 'ngspice', files: { 'package.cir': deck }, args: ['-n', '-b', 'package.cir'], outputFiles: ['package.dat'] })
  assert.doesNotMatch(result.stdout + result.stderr, /error|fatal|aborted/i)
  const values = result.files['package.dat'].trim().split('\n')[1].trim().split(/\s+/).map(Number)
  const omega = 2 * Math.PI * 1e6
  for (let i = 0; i < 2; i++) {
    const real = [0, 1].reduce((sum, j) => sum + data.R[i][j] * values[5 + 2 * j] - omega * data.L[i][j] * values[6 + 2 * j], 0)
    const imaginary = [0, 1].reduce((sum, j) => sum + data.R[i][j] * values[6 + 2 * j] + omega * data.L[i][j] * values[5 + 2 * j], 0)
    assert.ok(Math.abs(real - values[1 + 2 * i]) < 1e-7, 'real series impedance matches the full R matrix')
    assert.ok(Math.abs(imaginary - values[2 + 2 * i]) < 1e-7, 'imaginary series impedance matches signed mutual L')
    assert.ok(Math.abs(-values[10 + 2 * i] - values[6 + 2 * i] - omega * data.C[i][0] / 2) < 1e-8, 'board-side pi capacitance matches Maxwell C')
  }
})
