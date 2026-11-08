import test from 'node:test'
import assert from 'node:assert/strict'
import {maxAbs} from '../../src/extraction'
test('matrix norm has no engine argument-list lane limit',()=>{
  assert.equal(maxAbs(Array.from({length:400},()=>Array(400).fill(-3))),3)
})
