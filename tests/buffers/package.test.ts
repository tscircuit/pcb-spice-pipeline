import test from 'node:test'
import assert from 'node:assert/strict'
import {admitBuffers,compileBuffers} from '../../src/buffers'
import {geometryFromCircuitJson} from '../../src/board'
import {generalDeclarations,modelRunDefinition} from '../../src/simulation'
import {rootScope,sha256} from '../../src/kernel'
import {inMemoryInput} from '../fixtures/in-memory.mjs'

test('signal and supply package R/L/C are retained while source bytes and hashes stay exact',()=>{
  const input=inMemoryInput()
  const bytes=Buffer.from(input.ibisSources['models/test.ibs'].toString().replace('[Pin]','[Package]\nR_pkg .1 .1 .1\nL_pkg 2n 2n 2n\nC_pkg .2p .2p .2p\n[Pin]'))
  input.ibisSources['models/test.ibs']=bytes
  for (const model of input.circuitJson.filter((r:{type:string})=>r.type==='simulation_ibis_model')) model.include_package_parasitics=true
  const declarations=generalDeclarations(input.circuitJson,geometryFromCircuitJson(input.circuitJson,input.modeling),input.modeling)
  const admitted=admitBuffers(declarations.models,input.ibisSources,input.modeling,rootScope('buffers'))
  const compiled=compileBuffers(admitted.value,declarations.plans,modelRunDefinition)[0]
  for (const model of compiled) {
    assert.equal(model.sourceEvidence.sourceSha256,sha256(bytes))
    assert.equal(model.metadata.packagePolicy,'vendor')
    assert.deepEqual(model.metadata.omissions,[])
    const pins=Object.entries(model.spicePinMapping)
    for (const [i,[terminal]] of pins.entries()) {
      assert.match(model.source,new RegExp(`RPKG${i} ${terminal} PKGR${i} 0.1`))
      assert.match(model.source,new RegExp(`LPKG${i} PKGR${i} PKGL${i} 2e-9`))
    }
    assert.ok(pins.some(([terminal])=>terminal.startsWith('REF')))
    assert.ok(model.source.includes('CPKG'))
  }
  assert.equal(sha256(input.ibisSources['models/test.ibs']),sha256(bytes))
})

import { makeBoard, modeling as tiModeling } from '../../examples/single-ended/index.circuit'
import { convertWithPackage } from '../../src/buffers/package'

/** Electrical binding from real TSX; this unit test does not claim a field extraction. */
async function packageInput(): Promise<ReturnType<typeof modelRunDefinition>> {
  const cj = await makeBoard(true)
  const declarations = generalDeclarations(cj, { mappings: [] }, {})
  return modelRunDefinition(declarations.models[1], declarations.plans[0])
}
/** Small IBIS input model matching the real TSX pin declaration; package values are the variable under test. */
function packageBytes(input: Awaited<ReturnType<typeof packageInput>>, values: string): Uint8Array {
  return Buffer.from(`[IBIS Ver] 4.2\n[Component] ${input.definition.component}\n${values}\n[Pin] signal_name model_name\n2 A LVC1G04_IN_33\n3 GND GND\n5 VCC POWER\n[Model] LVC1G04_IN_33\nModel_type Input\nC_comp 1p 1p 1p\n[Voltage Range] 3.3 3.3 3.3\n[Power Clamp]\n-10 .1 .1 .1\n10 -.1 -.1 -.1\n[Gnd Clamp]\n-10 -.1 -.1 -.1\n10 .1 .1 .1\n[End]\n`)
}
test('review 4: vendor policy rejects missing and negative R/L/C on every mapped TSX pin', async () => {
  const input = await packageInput()
  for (const values of ['', '[Package]\nR_pkg -1 -1 -1\nL_pkg 2n 2n 2n\nC_pkg 1p 1p 1p', '[Package]\nR_pkg 0 0 0\nL_pkg -2n -2n -2n\nC_pkg 1p 1p 1p', '[Package]\nR_pkg 0 0 0\nL_pkg 0 0 0']) {
    assert.throws(() => convertWithPackage(packageBytes(input, values), input), { code: 'invalid_package' })
  }
})
test('review 4: explicit zero package values are valid rather than missing', async () => {
  const input = await packageInput()
  const result = convertWithPackage(packageBytes(input, '[Package]\nR_pkg 0 0 0\nL_pkg 0 0 0\nC_pkg 0 0 0'), input)
  assert.equal(result.metadata.packagePolicy, 'vendor')
  assert.deepEqual(result.metadata.omissions, [])
  assert.ok(!/^RPKG|^LPKG|^CPKG/m.test(result.source))
})


test('review 3: incomplete supply dynamics have a named buffer diagnostic', async () => {
  const input = await packageInput()
  const port = input.definition.pinMap['2']
  input.run.pinStates[port] = { mode: 'output', enabled: true }
  input.run.stimuli[port] = { unitInterval: .00005, startTime: 0, initialState: 0, inverted: false, pattern: { type: 'bits', bits: '0', repeat: true } }
  const bytes = Buffer.from(packageBytes(input, '[Package]\nR_pkg .1 .1 .1\nL_pkg 2n 2n 2n\nC_pkg 1p 1p 1p')).toString().replace('Model_type Input', 'Model_type 3-state').replace('[Power Clamp]', '[Pullup]\n-10 -.1 -.1 -.1\n10 .1 .1 .1\n[Pulldown]\n-10 -.1 -.1 -.1\n10 .1 .1 .1\n[Power Clamp]')
  assert.throws(() => convertWithPackage(Buffer.from(bytes), input), { code: 'ibis_supply_dynamics' })
})
