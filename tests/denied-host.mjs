// Runs in a fresh process so the public import graph is not already cached.
import assert from 'node:assert/strict'
import {builtinModules,registerHooks} from 'node:module'
import {readFileSync} from 'node:fs'
const input=JSON.parse(readFileSync(0,'utf8'))
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
// solver-utils and the routed stages time their steps with Date.now() and performance.now();
// reading the clock is the only host access left. Constructing dates stays denied.
globalThis.Date=new Proxy(Date,{construct:denied})
const {RoutedPipelineSolver}=await import('../dist/index.js')
const solver=new RoutedPipelineSolver(input,{runSolver:denied,progress:denied})
solver.solve()
assert.deepEqual(solver.getOutput().blocks,[])
assert.equal(JSON.stringify(input),before)
