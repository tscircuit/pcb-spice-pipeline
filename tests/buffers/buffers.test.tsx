import React from 'react'
import { parseIbis } from '@tscircuit/ibis-to-spice'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Single from '../support/unit-single-ended'
import { renderSignals } from '../support/signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { generalDeclarations, modelRunDefinition, bindExperiments, electricalSources } from '../../src/simulation'
import { admitBuffers, compileBuffers, receiverThresholds } from '../../src/buffers'
import { rootScope, sha256 } from '../../src/kernel'

const modelDir = process.env.IBIS_MODEL_DIR

test('real vendor packages and optional references survive public preflight; source hashes are evidence', { skip: !modelDir }, async () => {
  const bytes = await readFile(`${modelDir}/sn74lvc1g04.ibs`)
  const ibis = { 'models/sn74lvc1g04.ibs': bytes }
  const [prepared] = prepareBlocks(await renderSignals(<Single />), ibis)
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  const declarations = generalDeclarations(prepared.circuit, geometry, prepared.settings)
  const admitted = admitBuffers(declarations.models, ibis, {}, rootScope('buffers'))
  const compiled = compileBuffers(admitted.value, declarations.plans, modelRunDefinition)
  assert.doesNotThrow(() => bindExperiments({ ...declarations, electrical: electricalSources(prepared.circuit, prepared.settings, declarations.nodes) }, geometry, compiled))
  for (const model of compiled[0]) {
    assert.equal(model.sourceEvidence.sourceSha256, sha256(bytes))
    assert.equal(model.metadata.packagePolicy, 'vendor')
    assert.match(model.source, /RPKG/)
    for (const pin of model.metadata.pins) assert.ok(!Object.hasOwn(pin.references, 'external'))
  }
})

/** Vendor files are optional local inputs; no edited or synthetic IBIS bytes enter these cases. */
const corpus = process.env.IBIS_CORPUS_DIR

test('real AM335x Model Spec corners and Winbond DC limits override model scalars', { skip: !modelDir || !corpus }, async () => {
  const [prepared] = prepareBlocks(await renderSignals(<Single />), { 'models/sn74lvc1g04.ibs': await readFile(`${modelDir}/sn74lvc1g04.ibs`) })
  const base = [...prepared.pins.values()][0]
  for (const [file, name, expected] of [
    ['sprm552c.ibs', 'Model_1000', [[.85, .65], [.8125, .6125], [.8875, .6875]]],
    ['W631GG6MB-12.ibs', 'ODT_off', [[.9, .6], [.9, .6], [.9, .6]]],
  ] as const) {
    const text = await readFile(`${corpus}/${file}`, 'utf8')
    const document = parseIbis(text)
    const buffer = document.getBuffer(name)
    assert.ok(buffer, name)
    const pin = { ...base, text, document, buffer }
    for (let corner = 0; corner < 3; corner++) {
      const limits = receiverThresholds(pin, false, 'ibis', corner)
      assert.ok(Math.abs(limits.vih - expected[corner][0]) < 1e-12)
      assert.ok(Math.abs(limits.vil - expected[corner][1]) < 1e-12)
    }
  }
})
