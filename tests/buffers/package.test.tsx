import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { convertIbisModelToSpice, parseIbis } from '@tscircuit/ibis-to-spice'
import Single from '../support/unit-single-ended'
import Differential from '../support/unit-differential'
import { admittedBindings, renderSignals } from '../support/signal-render'
import { generalDeclarations, modelRunDefinition } from '../../src/simulation'
import { convertPackaged } from '../../src/buffers/package'

const modelDir = process.env.IBIS_MODEL_DIR

/** Use the real TSX board and unmodified vendor model, without invoking extraction. */
async function fixture(differential: boolean = false): Promise<{ bytes: Uint8Array; declarations: ReturnType<typeof generalDeclarations> }> {
  const file = differential ? 'sn65hvd72.ibs' : 'sn74lvc1g04.ibs'
  const bytes = await readFile(`${modelDir}/${file}`)
  const bindings = admittedBindings(await renderSignals(differential ? <Differential /> : <Single />), { [`models/${file}`]: bytes })
  return { bytes, declarations: generalDeclarations(bindings.circuitJson, bindings, bindings.modeling) }
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
