import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { geometryFromCircuitJson } from '../../src/board/index'
import { extractChannel } from '../../src/extraction/index'
import { rootScope } from '../../src/kernel/index'
import { beforeNative } from '../../scripts/before-native'
import { circuitJson, modeling as board } from '../../examples/crosstalk/index.circuit.tsx'

/** Persists each actual native request and response before another expensive solve starts. */
async function recordedNative(request,directory,index) {
  const path=`runs/2d-baseline/${directory}/native-${index}`
  await mkdir(path,{recursive:true})
  await writeFile(`${path}/request.json`,JSON.stringify(request,null,2))
  const output=await beforeNative(request)
  await writeFile(`${path}/output.json`,JSON.stringify(output,null,2))
  return output
}


test('opt-in actual SC70 routed-copper baseline, without a harness timeout', { skip: !process.env.SI_3D_BASELINE }, async () => {
  const modeling = { ...board, reduction: 'routed-copper', sections: 2,
    channelReference: { component: 'TX0', port: 'GND' }, groundReturn: { component: 'RX0', port: 'GND' },
    relativePermittivity: 4.1, viaPlatingMm: .025, viaEquivalentWidthMm: .35, omitThroughViaStubs: true,
    extraction: { minimumHz: 1, modelHz: 1e8, maximumHz: 1e9, filaments: 5, refinementFilaments: 9,
      convergenceTolerance: .05, capTolerance: .02, reciprocityTolerance: .025, dcResistanceTolerance: .002,
      maxPanelLengthMm: 1.53, groundMeshMm: .765 } }
  const start = performance.now()
  const result = {}
  const invocations = []
  try {
    const geometry = geometryFromCircuitJson(circuitJson, modeling)
    result.channel = (await extractChannel(geometry, modeling, rootScope('extraction'), {
      runSolver: async request => {
        const invocation = { request }
        invocations.push(invocation)
        invocation.output = await recordedNative(request,'crosstalk',invocations.length)
        return invocation.output
      }, progress: console.log,
    })).value
  } catch (error) {
    result.error = { code: error.code, message: error.message }
  }
  result.seconds = (performance.now() - start) / 1000
  await mkdir('runs/2d-baseline', { recursive: true })
  await writeFile('runs/2d-baseline/crosstalk.json', JSON.stringify(result, null, 2))
  await writeFile('runs/2d-baseline/crosstalk-invocations.json', JSON.stringify(invocations, null, 2))
  console.log(JSON.stringify(result))
  assert.equal(result.error?.code, 'mesh_convergence', 'The BEFORE regression must fail at the known mesh check, not an unrelated native error')
  assert.match(result.error.message, /R refinement residual/)
})

// Explicit controls reproduce the documented BEFORE method; none belongs to the new extraction API.
test('opt-in original TSX RS-485 straightened/routed mutual-L gap', { skip: !process.env.SI_3D_GAP }, async () => {
  const { makeGapBoard } = await import('../fixtures/rs485-gap.tsx')
  const circuitJson = await makeGapBoard()
  const results = {}
  const tolerance = .05 // The historical experiment's own refinement tolerance.
  let index = 0
  try {
    for (const reduction of ['straightened-stages','routed-copper']) {
      const modeling = { reduction, sections:1, profiles:{},
        lanes:['A','B'].map(port=>({port,from:{component:'TX',port},to:{component:'RX',port}})),
        channelReference:{component:'TX',port:'GND'},groundReturn:{component:'RX',port:'GND'},
        relativePermittivity:4.42,viaPlatingMm:.025,viaEquivalentWidthMm:.35,omitThroughViaStubs:true,
        extraction:{minimumHz:7.77,modelHz:777000,maximumHz:7770000,filaments:3,refinementFilaments:7,
          convergenceTolerance:tolerance,capTolerance:.02,reciprocityTolerance:.025,dcResistanceTolerance:.002,
          maxPanelLengthMm:1.27,groundMeshMm:.635} }
      const start = performance.now()
      const extracted = await extractChannel(geometryFromCircuitJson(circuitJson,modeling),modeling,rootScope('extraction'),{
        progress:console.log,runSolver:request=>recordedNative(request,`rs485-${reduction}`,index++),
      })
      results[reduction] = {seconds:(performance.now()-start)/1000,matrices:extracted.value.matrices}
    }
  } finally {
    await mkdir('runs/2d-baseline',{recursive:true})
    await writeFile('runs/2d-baseline/rs485-gap.json',JSON.stringify(results,null,2))
  }
  for (const [reduction,referenceH] of [['straightened-stages',11.716323252747581e-9],['routed-copper',4.169378152358665e-9]]) {
    const measured = results[reduction].matrices.reduce((sum,m)=>sum+m.L[0][1],0)
    console.log(JSON.stringify({reduction,measuredH:measured,referenceH,seconds:results[reduction].seconds}))
    assert.ok(Math.abs(measured/referenceH-1)<tolerance,`${reduction}: ${measured} versus historical ${referenceH}`)
  }
})
