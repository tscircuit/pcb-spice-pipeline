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
