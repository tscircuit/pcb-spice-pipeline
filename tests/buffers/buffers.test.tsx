import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Single from '../support/unit-single-ended'
import { admittedBindings, renderSignals } from '../support/signal-render'
import { generalDeclarations, modelRunDefinition } from '../../src/simulation'
import { admitBuffers, compileBuffers } from '../../src/buffers'
import { rootScope, sha256 } from '../../src/kernel'

const modelDir = process.env.IBIS_MODEL_DIR

test('real vendor packages and optional references survive public preflight; source hashes are evidence', { skip: !modelDir }, async () => {
  const bytes = await readFile(`${modelDir}/sn74lvc1g04.ibs`)
  const ibis = { 'models/sn74lvc1g04.ibs': bytes }
  const bindings = admittedBindings(await renderSignals(<Single />), ibis)
  const declarations = generalDeclarations(bindings.circuitJson, bindings, bindings.modeling)
  const admitted = admitBuffers(declarations.models, ibis, {}, rootScope('buffers'))
  const compiled = compileBuffers(admitted.value, declarations.plans, modelRunDefinition)
  for (const model of compiled[0]) {
    assert.equal(model.sourceEvidence.sourceSha256, sha256(bytes))
    assert.equal(model.metadata.packagePolicy, 'vendor')
    assert.match(model.source, /RPKG/)
    for (const pin of model.metadata.pins) assert.ok(!Object.hasOwn(pin.references, 'external'))
  }
})
