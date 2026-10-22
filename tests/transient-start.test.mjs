import test from 'node:test'
import assert from 'node:assert/strict'
import {runPipeline} from '../src/index.js'
import {inMemoryInput,fixtureSolver} from './fixtures/in-memory.mjs'

test('a transient missing its beginning fails before reporting partial eyes',async()=>{
  await assert.rejects(runPipeline({...inMemoryInput(),runSolver:async request=>{
    const result=await fixtureSolver(request)
    if(request.solver==='ngspice') {
      const [header,...samples]=result.files['waveform.dat'].trim().split('\n')
      result.files['waveform.dat']=[header,...samples.slice(50)].join('\n')+'\n'
    }
    return result
  }}),error=>error.code==='simulation_start')
})
