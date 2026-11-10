import React from 'react'
import { Circuit } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { convertPackaged } from '../../src/buffers/package'
import { coupledPackageElements } from '../../src/buffers/coupled-package'
import { createNativeSolver } from '../../src/adapters'

import { source, Board } from '../support/coupled-package-fixture'

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
  // IBIS 6.1 section 7: unlisted pins use [Pin] then [Package], while
  // an unlisted member of a modeled [Pin Mapping] rail bus is merged.
  const partial = source.slice(0, source.indexOf('[Define Package Model]')) + `[Define Package Model] coupled
[Manufacturer] Test
[OEM] Test
[Description] Only the signal pins have matrix data
[Number Of Pins] 2
[Pin Numbers]
B1
A1
[Model Data]
[Resistance Matrix] Full_matrix
[Row] B1
2 .2
[Row] A1
1
[Inductance Matrix] Full_matrix
[Row] B1
4n -1n
[Row] A1
2n
[Capacitance Matrix] Full_matrix
[Row] B1
3p -.5p
[Row] A1
2p
[End Model Data]
[End Package Model]
[End]`
  const partialSource = partial.replace('G1 VSS GND 6 6n 6p', 'G1 VSS GND NA NA NA')
  const variantInput = { ...input, definition: { ...input.definition, source: { file: 'fixture.ibs' } } }
  const unlisted = convertPackaged(new TextEncoder().encode(partialSource), variantInput)
  assert.deepEqual(unlisted.metadata.packageData.matrices?.pins, ['A1', 'B1'])
  assert.match(unlisted.source, /RPKGU2 REF0 \S+ 7\n/)
  assert.match(unlisted.source, /LPKGU2 \S+ \S+ 7(?:\.0+1)?e-9\n/)
  assert.match(unlisted.source, /RPKGU3 REF1 \S+ 99\n/)
  assert.match(unlisted.source, /LPKGU3 \S+ \S+ 9\.9e-8\n/)
  assert.match(unlisted.source, /CPKGU2a REF0 DIE3 3\.5e-12/)
  assert.match(unlisted.source, /CPKGU3a REF1 DIE3 4\.95e-11/)
  assert.match(unlisted.source, /VPDN2 DIE2 0 1\.5/)
  assert.match(unlisted.source, /VPDN3 DIE3 0 0/)
  const identifiers = unlisted.source.split('\n').filter(line => /^[RVLCHK]PKG/.test(line)).map(line => line.split(' ')[0])
  assert.equal(new Set(identifiers).size, identifiers.length, 'scalar and matrix element names cannot collide')
  assert.equal(unlisted.metadata.packageData.mappedPins.find(pin => pin.physicalPin === 'V1')?.resistanceOhms, 7)
  assert.equal(unlisted.metadata.packageData.mappedPins.find(pin => pin.physicalPin === 'G1')?.resistanceOhms, 99)
  const positiveC = partial.replace('3p -.5p', '3p .5p')
  assert.throws(() => convertPackaged(new TextEncoder().encode(positiveC), variantInput), /Maxwell.*positive off-diagonal/, 'positive mutual magnitudes are not IBIS Maxwell entries')
  const busSource = source.replace('[Model] input', `[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref
A1 GND VDD GND VDD
B1 GND VDD GND VDD
G1 GND NC NC NC
G2 GND NC NC NC
V1 NC VDD NC NC
V2 NC VDD NC NC
[Model] input`).replace('[Pin] signal_name model_name R_pin L_pin C_pin', '[Pin] signal_name model_name R_pin L_pin C_pin\nG2 VSS GND\nV2 VDD POWER')
  const busStart = busSource.indexOf('[Define Package Model]')
  const mergedSource = busSource.slice(0, busStart) + busSource.slice(busStart).replaceAll('G1', 'G2').replaceAll('V1', 'V2')
  const merged = convertPackaged(new TextEncoder().encode(mergedSource), { ...variantInput, definition: { ...variantInput.definition,
    references: Object.fromEntries(['A1', 'B1'].map(pin => [pin, { pullup: pinMap.V1, powerClamp: pinMap.V1, pulldown: pinMap.G1, groundClamp: pinMap.G1 }])) } })
  assert.deepEqual(merged.metadata.packageData.matrices?.pins, ['A1', 'B1', 'V2', 'G2'])
  assert.deepEqual(merged.metadata.packageData.matrices?.mergedPins, { V1: 'V2', G1: 'G2' })
  assert.match(merged.source, /VPKGM2 REF0 PKGM2 0/)
  assert.match(merged.source, /VPKGM3 REF1 PKGM3 0/)
  assert.doesNotMatch(merged.source, /RPKGU|LPKGU|CPKGU/)
  const noSelectedRows = partial.replace('[Model] input', 'C1 C input\nD1 D input\n[Model] input')
  const noSelectedStart = noSelectedRows.indexOf('[Define Package Model]')
  const scalarSource = noSelectedRows.slice(0, noSelectedStart) + noSelectedRows.slice(noSelectedStart).replaceAll('A1', 'C1').replaceAll('B1', 'D1')
  const scalar = convertPackaged(new TextEncoder().encode(scalarSource), variantInput)
  assert.deepEqual(scalar.metadata.packageData.matrices?.pins, [])
  assert.match(scalar.source, /RPKGU0 PAD0 \S+ 9\n/)
  assert.doesNotMatch(scalar.source, /KPKG/)
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
  for (const mixed of [unlisted, merged]) {
    const name = /^\.subckt (\S+)/m.exec(mixed.source)![1]
    const deck = ['Mixed package only AC oracle', mixed.source, `XTEST a b v g ${name}`, 'VA a 0 ac 1', 'VB b 0 ac 0', 'VV v 0 1.5', 'VG g 0 0',
      '.control', 'ac lin 1 1Meg 1Meg', 'quit', '.endc', '.end'].join('\n')
    const result = await solve({ solver: 'ngspice', files: { 'mixed.cir': deck }, args: ['-n', '-b', 'mixed.cir'], outputFiles: [] })
    assert.doesNotMatch(result.stdout + result.stderr, /error|fatal|aborted|singular/i, 'mixed scalar/matrix and merged rail netlists are valid in ngspice')
    assert.match(result.stdout, /No\. of Data Rows\s*:\s*1/)
  }
})
