import React from 'react'
import { Circuit } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { source, Board } from './coupled-package-fixture'
import { convertPackaged } from '../../src/buffers/package'
import { sha256 } from '../../src/kernel'

test('TSX positive vendor capacitance magnitudes require a visible, hashed Maxwell correction', async () => {
  const bytes = new TextEncoder().encode(source.replaceAll('-.2p', '.2p').replaceAll('-.5p', '.5p').replaceAll('-.1p', '.1p'))
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(bytes) } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  const model = circuit.getCircuitJson().find(record => record.type === 'simulation_ibis_model')!
  const pinMap = model.ibis_pin_name_to_source_port_id
  const input = { definition: { source: { file: 'fixture.ibs' }, component: 'fixture', pinMap, corner: 'typical' as const, packagePolicy: 'vendor' as const },
    run: { duration: '1ns', pinStates: { [pinMap.A1]: { mode: 'input' as const }, [pinMap.B1]: { mode: 'input' as const } }, stimuli: {} } }
  const log = test.mock.method(console, 'warn', (..._args: unknown[]): void => {})
  const converted = convertPackaged(bytes, input)
  const warning = converted.warnings.find(message => message.includes('negated 6 off-diagonal capacitance entries'))
  assert.ok(warning, 'both symmetric entries of each nonzero pair are counted')
  assert.ok(warning.includes('fixture.ibs') && warning.includes(sha256(bytes)) && warning.includes('coupled'))
  assert.ok(log.mock.calls.some(call => call.arguments.includes(warning)))
  assert.equal(converted.sourceSha256, sha256(bytes), 'evidence hashes the unchanged vendor bytes')
  assert.match(converted.source, /CPKG0_1a PAD0 PAD1 2\.5e-13/)
  for (const invalid of [source.replace('-.2p', '.2p'), source.replace('3p -.2p -.5p', '.1p .2p .5p').replaceAll('-.1p', '.1p')]) {
    assert.throws(() => convertPackaged(new TextEncoder().encode(invalid), input), /Maxwell capacitance|positive definite/)
  }
  const unchanged = convertPackaged(new TextEncoder().encode(source), input)
  assert.deepEqual(converted.metadata.packageData.matrices?.C, unchanged.metadata.packageData.matrices?.C)
  assert.ok(!unchanged.warnings.some(message => message.includes('negated')))
})
