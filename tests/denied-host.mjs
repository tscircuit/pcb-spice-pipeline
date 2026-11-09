// Runs in a fresh process so the public import graph is not already cached.
import assert from 'node:assert/strict'
import {builtinModules,registerHooks} from 'node:module'
import {readFileSync} from 'node:fs'
import {fixtureSolver} from './fixtures/solver.mjs'
const input=JSON.parse(readFileSync(0,'utf8'))
const requests=[]
const progress=[]
const before=JSON.stringify(input)
const denied=()=>{
  throw Error('Implicit host action denied')
}
const builtin=new Set([...builtinModules,...builtinModules.map(name=>'node:'+name)])
registerHooks({resolve(specifier,context,next){
  if(builtin.has(specifier)||specifier==='react'||specifier.startsWith('@tscircuit/core')||specifier.startsWith('tsx')||/^https?:/.test(specifier)) throw Error('Forbidden import '+specifier+' from '+context.parentURL)
  return next(specifier,context)
}})
globalThis.fetch=denied
globalThis.console=new Proxy({},{get:()=>denied})
Object.defineProperty(globalThis,'process',{get:denied})
globalThis.Date=new Proxy(Date,{construct:denied,get:(target,key)=>key==='now'?denied:Reflect.get(target,key)})
Object.defineProperty(globalThis,'performance',{get:denied})
const {runPipeline,generateReport}=await import('../dist/index.js')
await assert.rejects(runPipeline({...input,modeling:{},runSolver:fixtureSolver}),{code:'signal_integrity_input'})
if(input.circuitJson.length){
  const result=await runPipeline({...input,runSolver:async request=>{
    requests.push(structuredClone(request))
    return fixtureSolver(request)
  },onProgress:message=>progress.push(message)})
  assert.ok(requests.length>=4 && requests.every(request=>request.solver==='ngspice'))
  assert.ok(progress.length>=2)
  assert.equal(result.blocks.length,1)
  assert.equal(result.matrices.length,0)
  assert.equal(result.experiments[0].solverInvocations,requests.length)
  assert.ok(result.blocks[0].results.some(record=>record.type==='simulation_signal_eye'))
  assert.ok(result.blocks[0].results.some(record=>record.type==='simulation_signal_waveform'))
  const report=generateReport(result)
  assert.match(report['results.html'],/id="simulation-data"/)
  assert.doesNotMatch(report['results.html'],/<script[^>]+src=|https?:\/\//)
  assert.deepEqual(report,generateReport(result))
}else assert.deepEqual((await runPipeline({...input,runSolver:fixtureSolver})).blocks,[])
assert.equal(JSON.stringify(input),before)
