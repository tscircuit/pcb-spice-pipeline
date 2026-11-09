import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMatrix,loopImpedance,referenceCapacitance,referenceConductance,multiply,transpose,parseFastHenry,parseFasterCap } from '../../src/extraction/index.js'
test('shared return resistance survives the full loop transform',()=>{
  assert.deepEqual(loopImpedance([[2,0,0],[0,3,0],[0,0,5]]),[[7,5],[5,8]])
  validateMatrix([[7,5],[5,8]],'R')
})
test('three signals retain shared-return coupling and parse four-conductor solver output',()=>{
  assert.deepEqual(loopImpedance([[2,0,0,0],[0,3,0,0],[0,0,4,0],[0,0,0,5]]),[[7,5,5],[5,8,5],[5,5,9]])
  const impedance='Impedance matrix for frequency = 1 4 x 4\n'+Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>`${i===j?i+2:0} 0j`).join(' ')).join('\n')
  assert.equal(parseFastHenry(impedance)[0].R.length,4)
  const cap='Capacitance matrix is:\nDimension 4 x 4\n'+Array.from({length:4},(_,i)=>'g_'+i+' '+Array.from({length:4},(_,j)=>i===j?5:-1).join(' ')).join('\n')
  const parsed=parseFasterCap(cap)
  assert.equal(referenceCapacitance(parsed.matrix).matrix.length,3)
})
test('grounded capacitance preserves signal charge and energy with the return held at zero',()=>{
  const C=[[4,-1,-2],[-1,5,-3],[-2,-3,7]]
  const r=referenceCapacitance(C)
  const v=[1.2,-.7]
  const full=[[v[0]],[v[1]],[0]]
  const q=multiply(C,full)
  const small=multiply(r.matrix,[[v[0]],[v[1]]])
  assert.deepEqual(q.slice(0,-1),small)
  assert.notEqual(q.flat().reduce((a,b)=>a+b),0)
  assert.equal(multiply(transpose(full),q)[0][0],multiply([v],small)[0][0])
  assert.deepEqual(r.matrix,[[4,-1],[-1,5]])
})
test('nonpassive and nonreciprocal matrices fail before normalization',()=>{
  assert.throws(()=>validateMatrix([[1,2],[2,1]],'L'),/passivity/)
  assert.throws(()=>validateMatrix([[1,.2],[.5,1]],'C'),/reciprocity/)
  assert.throws(()=>referenceCapacitance([[1,-1,0],[-1,1,0],[0,0,0]]),/capacitance_sign/)
})

test('Option A grounds C while lossless G remains zero', () => {
  const primitive = [[4, -1, -1], [-1, 4, -1], [-1, -1, 4]]
  assert.deepEqual(referenceCapacitance(primitive).matrix, [[4, -1], [-1, 4]])
  assert.deepEqual(referenceConductance(primitive.map(row => row.map(() => 0))), [[0, 0], [0, 0]])
})

test('signal-block rejection keeps the 2.5% limit, signs and positive energy', () => {
  assert.throws(() => referenceCapacitance([[4, -.1, -1], [-.3, 4, -1], [-1, -1, 4]]), /reciprocity/)
  assert.throws(() => referenceCapacitance([[1, -2, 0], [-2, 4, 0], [0, 0, 1]]), /capacitance_sign/)
  assert.throws(() => referenceCapacitance([[4, .1, 0], [.1, 4, 0], [0, 0, 1]]), /capacitance_sign/)
  assert.throws(() => referenceCapacitance([[4, NaN, 0], [-1, 4, 0], [0, 0, 1]]), /matrix_format/)
})
