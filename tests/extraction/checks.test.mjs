import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMatrix } from '../../src/extraction/index.js'
test('nonpassive and nonreciprocal matrices fail before normalization',()=>{
  assert.throws(()=>validateMatrix([[1,2],[2,1]],'L'),/passivity/)
  assert.throws(()=>validateMatrix([[1,.2],[.5,1]],'C'),/reciprocity/)
})

test('matrix validation has no dimension cap',()=>{
  const size=12
  const matrix=Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>i===j?2:.1))
  assert.equal(validateMatrix(matrix,'L').matrix.length,size)
})
