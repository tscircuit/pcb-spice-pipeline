import React from 'react'
import { Circuit } from '@tscircuit/core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Board, source } from '../support/coupled-package-fixture'
import { modelRunDefinition } from '../../src/simulation'

test('TSX model pruning removes selections and references for unused physical pins', async () => {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(source) } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  const model = circuit.getCircuitJson().filter(record => record.type === 'simulation_ibis_model')[0]
  const pinMap = model.ibis_pin_name_to_source_port_id
  const references = { pullup_reference_source_port_id: pinMap.V1, pulldown_reference_source_port_id: pinMap.G1 }
  model.ibis_pin_name_to_model_name = { A1: 'input', B1: 'input' }
  model.ibis_pin_name_to_reference_source_port_ids = { A1: references, B1: references }
  // prepareBlocks trims physical mappings after spatial scope selection, retaining these source dictionaries.
  delete pinMap.B1
  const definition = modelRunDefinition({ ...model, pipelineId: 'scoped' }, { durationSeconds: 2e-9, states: [], stimuli: [] }).definition
  assert.deepEqual(Object.keys(definition.modelSelections!), ['A1'])
  assert.deepEqual(Object.keys(definition.references!), ['A1'])
  assert.ok(!('B1' in definition.pinMap))
})
