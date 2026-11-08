import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMatrix, channelSpice, solveCrossSection } from '../../src/extraction'
import { channelStage } from '../support/channel'

test('invalid passive networks fail before a native request', () => {
  assert.throws(() => validateMatrix([[NaN]],'R'), {code:'matrix_format'})
  assert.throws(() => validateMatrix([[0]],'R'), {code:'matrix_zero'})
  assert.throws(() => channelSpice([],0), {code:'matrix_dimension'})
  const e = channelStage({R:[[1,0],[0,1]],L:[[1,0],[0,1]],C:[[1,2],[2,1]]})
  assert.throws(() => channelSpice([e],2), {code:'passivity'})
  assert.throws(() => solveCrossSection({conductors:[{id:'bad',group:0,xMin:0,xMax:Infinity,zMin:0,zMax:1,conductivitySm:1}],dielectrics:[]}), {code:'mesh_convergence'})
})

test('an absent derived frequency band fails before any field work', async () => {
  const {extractChannel} = await import('../../src/extraction')
  const {rootScope} = await import('../../src/kernel')
  await assert.rejects(extractChannel({} as never,{} as never,rootScope('extraction'),{runSolver:async()=>{
    throw Error('unexpected solver')
  },progress:()=>{}}),{code:'model_frequency'})
})
