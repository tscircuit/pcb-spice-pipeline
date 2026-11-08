import test from 'node:test'
import assert from 'node:assert/strict'
import { solve, multiply } from '../../src/extraction'

test('an unavailable WebAssembly backend raises a named diagnostic', t=>{
  const mock=t.mock.method(WebAssembly,'Module',()=>{
    throw Error('disabled host')
  })
  assert.throws(()=>solve([[1]],[[1]]),{code:'matrix_backend'})
  mock.mock.restore()
})
test('unavailable matrix storage is reported without a size clamp',t=>{
  const mock=t.mock.method(WebAssembly.Memory.prototype,'grow',()=>{
    throw Error('allocator fault')
  })
  const size=256
  assert.throws(()=>solve(Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>Number(i===j))),Array.from({length:size},()=>[1])),{code:'matrix_storage'})
  mock.mock.restore()
})
test('pivoted multiple-RHS solves satisfy A*x=b across dimensions and scales',()=>{
  for (const size of [2,12,33]) {
    const matrix=Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>i===j?size+1:Math.sin((i+1)*(j+1))))
    const expected=Array.from({length:size},(_,i)=>[Math.sin(i),i/size])
    const rhs=multiply(matrix,expected)
    for (const scale of [1e-12,1,1e12]) {
      const actual=solve(matrix.map(row=>row.map(v=>v*scale)),rhs.map(row=>row.map(v=>v*scale)))
      assert.ok(Math.max(...actual.flatMap((row,i)=>row.map((v,j)=>Math.abs(v-expected[i][j]))))<1e-12)
    }
  }
  assert.throws(()=>solve([[0]],[[1]]),{code:'matrix_singular'})
})
