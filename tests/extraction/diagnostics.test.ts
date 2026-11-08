import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMatrix, channelSpice, solveCrossSection, loopImpedance } from '../../src/extraction'
import { channelStage } from '../support/channel'

test('invalid passive networks fail before a native request', () => {
  assert.throws(() => validateMatrix([[NaN]],'R'), {code:'matrix_format'})
  assert.throws(() => validateMatrix([[0]],'R'), {code:'matrix_zero'})
  assert.throws(() => channelSpice([],0), {code:'matrix_dimension'})
  assert.throws(() => loopImpedance([[1]]), {code:'matrix_dimension'})
  const e = channelStage({R:[[1,0],[0,1]],L:[[1,0],[0,1]],C:[[1,2],[2,5]]})
  assert.throws(() => channelSpice([e],2), {code:'capacitance_sign'})
  assert.throws(() => solveCrossSection({conductors:[{id:'bad',group:0,xMin:0,xMax:Infinity,zMin:0,zMax:1,conductivitySm:1}],dielectrics:[]}), {code:'mesh_convergence'})
})
