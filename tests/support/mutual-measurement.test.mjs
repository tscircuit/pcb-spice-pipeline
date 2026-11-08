import test from 'node:test'
import assert from 'node:assert/strict'
import {measureMutual} from '../../scripts/measure-mutual.mjs'
test('mutual-L measurement follows folded path currents and refuses ambiguous paths',()=>{
  const stages=[{stage:0,ports:[{lane:'A',from:'IN0',to:'MID'},{lane:'B',from:'IN1',to:'OUT1'}],L:[[2,1],[1,2]]},
    {stage:1,ports:[{lane:'A',from:'OUT0',to:'MID'},{lane:'B',from:'IN1',to:'OUT1'}],L:[[2,.2],[.2,2]]}]
  // B must also form a single path; split it at the common midpoint.
  stages[0].ports[1].to='MID_B'
  stages[1].ports[1].from='MID_B'
  assert.equal(measureMutual(stages,'A','B',0,1),.8)
  assert.throws(()=>measureMutual([...stages,stages[0]],'A','B',0,1),/mutual_path_ambiguous/)
})
