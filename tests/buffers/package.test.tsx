import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { convertIbisModelToSpice, parseIbis } from '@tscircuit/ibis-to-spice'
import Single from '../support/unit-single-ended'
import Differential from '../support/unit-differential'
import { renderSignals } from '../support/signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { generalDeclarations, modelRunDefinition, electricalSources, generalSimulationSpice } from '../../src/simulation'
import { convertPackaged } from '../../src/buffers/package'
import { createNativeSolver } from '../../src/adapters'
import { waveformConvergence } from '../../src/observation'

const modelDir = process.env.IBIS_MODEL_DIR

/** Use the real TSX board and unmodified vendor model, without invoking extraction. */
async function fixture(differential: boolean = false): Promise<{ bytes: Uint8Array; prepared: ReturnType<typeof prepareBlocks>[number]; geometry: ReturnType<typeof geometryFromCircuitJson>; declarations: ReturnType<typeof generalDeclarations> }> {
  const file = differential ? 'sn65hvd72.ibs' : 'sn74lvc1g04.ibs'
  const bytes = await readFile(`${modelDir}/${file}`)
  const [prepared] = prepareBlocks(await renderSignals(differential ? <Differential /> : <Single />), { [`models/${file}`]: bytes })
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  return { bytes, prepared, geometry, declarations: generalDeclarations(prepared.circuit, geometry, prepared.settings) }
}

test('ideal die rails preserve every pin package at the typical corner', { skip: !modelDir }, async () => {
  for (const differential of [false, true]) {
    const { bytes, declarations } = await fixture(differential)
    const document = parseIbis(new TextDecoder().decode(bytes))
    for (const model of declarations.models) {
      const input = modelRunDefinition(model, declarations.plans[0])
      const converted = convertPackaged(bytes, input)
      const die = convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, input.run)
      const component = document.components[input.definition.component]
      for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
        const physical = Object.keys(input.definition.pinMap).find(pin => input.definition.pinMap[pin] === port)!
        const pin = component.pins[physical]
        assert.ok(converted.source.includes(`RPKG${i} ${terminal} PKGR${i} ${pin.resistance ?? component.package.resistance![0]}`))
        assert.ok(converted.source.includes(`LPKG${i} PKGR${i} PKGL${i} ${pin.inductance ?? component.package.inductance![0]}`))
        assert.ok(converted.source.includes(`CPKG${i}a ${terminal} `))
        assert.ok(converted.source.includes(`CPKG${i}b PKGL${i} `))
        if (/^(power|gnd)$/i.test(pin.model)) {
          const buffer = document.getBuffer(converted.metadata.pins[0].model)
          const voltage = /^power$/i.test(pin.model) ? (buffer.pullupReference ?? buffer.voltage)[0] : (buffer.pulldownReference ?? [0, 0, 0])[0]
          assert.ok(converted.source.includes(`VPDN${i} DIE${i} 0 ${voltage}`))
        }
      }
      // Renaming only package nodes must preserve the converter's rail references and KU/KD.
      /** Recover original terminal names to compare the unchanged die buffer and drive tables. */
      const normalize = (line: string): string => line.replace(/(?:PKGL|DIE)(\d+)/g, (_, index) => Object.keys(converted.spicePinMapping)[Number(index)])
      assert.deepEqual(converted.source.match(/^XBUF.*$/gm)?.map(normalize) ?? [], die.source.match(/^XBUF.*$/gm) ?? [])
      /** Upstream holds each state until 1 fs before an edge; the pipeline starts the edge from that held state. */
      const held = (line: string): string => line.replace(/PWL\((.*)\)/, (_, body: string) => {
        const knots = body.split(' ')
        const kept: string[] = []
        for (let i = 0; i < knots.length; i += 2) {
          if (i + 2 < knots.length && Number(knots[i + 2]) - Number(knots[i]) < 1e-14) kept.push(knots[(i += 2)], knots[i - 1])
          else kept.push(knots[i], knots[i + 1])
        }
        return `PWL(${kept.join(' ')})`
      })
      assert.deepEqual(converted.source.match(/^VK[UD].*$/gm)?.map(normalize) ?? [], die.source.match(/^VK[UD].*$/gm)?.map(held) ?? [])
      assert.deepEqual(converted.metadata.omissions, [])
    }
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
