import test from 'node:test'
import assert from 'node:assert/strict'
import {runPipeline} from '../src/index.js'
import {inMemoryInput,fixtureSolver} from './fixtures/in-memory.mjs'

test('recovered operating-point warnings retain a complete finite transient',async()=>{
  const result=await runPipeline({...inMemoryInput(),runSolver:async request=>({
    ...await fixtureSolver(request),stderr:request.solver==='ngspice'
      ?'Warning: singular matrix: check node xchan.s10_0\nWarning: True gmin stepping failed\nNote: Transient op started\n':'',
  })})
  assert.equal(result.experiments[0].waveform.rows.length,101)
})
