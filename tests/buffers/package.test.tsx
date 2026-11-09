import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { convertIbisModelToSpice, parseIbis } from '@tscircuit/ibis-to-spice'
import Single from '../support/unit-single-ended'
import { renderSignals } from '../support/signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { generalDeclarations, modelRunDefinition, electricalSources, generalSimulationSpice } from '../../src/simulation'
import { convertPackaged } from '../../src/buffers/package'
import { createNativeSolver } from '../../src/adapters'
import { waveformConvergence } from '../../src/observation'

const modelDir = process.env.IBIS_MODEL_DIR

/** Use the real TSX board and unmodified vendor model, without invoking extraction. */
async function fixture(): Promise<{ bytes: Uint8Array; prepared: ReturnType<typeof prepareBlocks>[number]; geometry: ReturnType<typeof geometryFromCircuitJson>; declarations: ReturnType<typeof generalDeclarations> }> {
  const bytes = await readFile(`${modelDir}/sn74lvc1g04.ibs`)
  const [prepared] = prepareBlocks(await renderSignals(<Single />), { 'models/sn74lvc1g04.ibs': bytes })
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  return { bytes, prepared, geometry, declarations: generalDeclarations(prepared.circuit, geometry, prepared.settings) }
}

test('ideal PDN keeps die references on perfect rails and preserves every signal package at each corner', { skip: !modelDir }, async () => {
  const { bytes, declarations } = await fixture()
  const document = parseIbis(new TextDecoder().decode(bytes))
  for (const [corner, selection] of ['typical', 'minimum', 'maximum'].entries()) for (const model of declarations.models) {
    const input = modelRunDefinition(model, declarations.plans[0])
    input.definition.corner = selection as typeof input.definition.corner
    const converted = convertPackaged(bytes, input)
    const die = convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, input.run)
    const component = document.components[input.definition.component]
    for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
      const physical = Object.keys(input.definition.pinMap).find(pin => input.definition.pinMap[pin] === port)!
      const pin = component.pins[physical]
      if (/^(power|gnd)$/i.test(pin.model)) {
        assert.doesNotMatch(converted.source, new RegExp(`^[RLC]PKG${i}[ab]? `, 'm'))
        assert.ok(converted.source.includes(terminal))
      } else {
        assert.ok(converted.source.includes(`RPKG${i} ${terminal} PKGR${i} ${pin.resistance ?? component.package.resistance![corner]}`))
        assert.ok(converted.source.includes(`LPKG${i} PKGR${i} PKGL${i} ${pin.inductance ?? component.package.inductance![corner]}`))
        assert.ok(converted.source.includes(`CPKG${i}a ${terminal} `))
        assert.ok(converted.source.includes(`CPKG${i}b PKGL${i} `))
      }
    }
    // The converter's rail references and unbounded KU/KD must survive verbatim.
    const buffers = converted.source.match(/^XBUF.*$/gm)!
    assert.deepEqual(buffers.map(line => line.replace(/PKGL\d+/g, 'PAD0')), die.source.match(/^XBUF.*$/gm))
    assert.deepEqual(converted.source.match(/^VK[UD].*$/gm), die.source.match(/^VK[UD].*$/gm))
    assert.match(converted.metadata.omissions.join(' '), /pdn="ideal"/)
  }
})

test('native single-ended vendor buffers settle under section refinement with ideal die rails', { skip: !modelDir || !process.env.NGSPICE_BIN }, async () => {
  const { bytes, prepared, geometry, declarations } = await fixture()
  const plan = { ...declarations.plans[0], durationSeconds: 3.6e-7, startTimeSeconds: 3.49e-7 }
  const models = declarations.models.map(model => ({ ...convertPackaged(bytes, modelRunDefinition(model, plan)), name: model.ibis_component_name }))
  const electrical = electricalSources(prepared.circuit, prepared.settings, declarations.nodes)
  const solve = createNativeSolver({ timeoutMs: 30000, tools: { ngspice: process.env.NGSPICE_BIN } })
  // Fixed native-extracted totals from the 10 mm fixture's section investigation.
  // This regression exercises transient refinement; full extraction is verified by the native runner.
  const matrices = [{ R: [[.330663944]], L: [[1.285523041626e-8]], C: [[3.88653942536e-13]] }]
  const traces: number[][][] = []
  for (const sections of [4, 8]) {
    const deck = generalSimulationSpice(plan, geometry, { sections }, matrices, models, declarations.nodes, electrical)
    const output = await solve({ solver: 'ngspice', files: { 'simulation.cir': deck }, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
    assert.doesNotMatch(output.stdout + output.stderr, /error|fatal|aborted|timestep too small/i)
    const rows = output.files['waveform.dat'].trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number))
    assert.ok(Math.abs(rows.at(-1)![0] - plan.durationSeconds) < 1e-15, 'native transient completed')
    traces.push(rows)
  }
  const gate = Math.max(plan.startTimeSeconds, traces[0][0][0], traces[1][0][0])
  const check = waveformConvergence(traces[0], traces[1], gate, [3.3])
  assert.equal(check.accepted, true, JSON.stringify(check))
  assert.ok(check.probes[0].peak_change_v < .002, 'receiver section peak changes by less than 2 mV')
})
