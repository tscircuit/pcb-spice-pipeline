import test from 'node:test'
import assert from 'node:assert/strict'
import { namespaceSpice, simulationSpiceOptions } from '../../src/simulation'

test('subcircuit namespaces preserve terminal names and disambiguate internal models', () => {
  const renamed = namespaceSpice('.subckt FILTER A B\nR1 A B 120\n.ends FILTER\n', 'P0')
  assert.equal(renamed.wrapper, 'P0_FILTER')
  assert.match(renamed.source, /R1 A B 120/)
})

test('the transient defaults keep controlled numerical tolerances', () => {
  assert.equal(simulationSpiceOptions().method, 'gear')
  assert.throws(() => simulationSpiceOptions({ method: 'euler' }), { code: 'spice_options' })
})
