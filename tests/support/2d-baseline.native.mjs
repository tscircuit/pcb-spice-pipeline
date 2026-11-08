import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { geometryFromCircuitJson } from '../../src/board/index'
import { extractChannel } from '../../src/extraction/index'
import { rootScope } from '../../src/kernel/index'
import { beforeNative } from '../../scripts/before-native'
import { circuitJson, modeling as board } from '../../examples/crosstalk/index.circuit.tsx'

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
        invocation.output = await beforeNative(request)
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
