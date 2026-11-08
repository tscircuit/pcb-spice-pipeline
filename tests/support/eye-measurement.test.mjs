import test from 'node:test'
import assert from 'node:assert/strict'
import {measureEye} from '../../scripts/measure-eyes.mjs'

test('independent observed-eye estimator finds exact affine envelope opening and threshold crossings',()=>{
  const rows=[[0,0],[.8,0],[1.2,1],[1.8,1],[2.2,0],[2.8,0],[3.2,1],[4,1]]
  const eye={column:1,unitIntervalSeconds:1,timeOriginSeconds:0,startTimeSeconds:0,endTimeSeconds:4}
  const measured=measureEye(rows,eye,'01',[.25,.75])
  assert.equal(measured.heightV,1)
  assert.ok(Math.abs(measured.widthUi-.8)<1e-12)
  assert.throws(()=>measureEye(rows,eye,'0',[.25,.75]),/high and low symbols/)
})
