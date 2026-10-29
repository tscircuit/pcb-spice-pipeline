import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeChannel, modeling } from './fixtures/native-channel.js'
import { geometryFromCircuitJson } from '../src/geometry.js'
import { extractChannel } from '../src/extraction.js'
import type { RunSolver, SolverRequest, FileMap } from '../src/solver.js'

// Physical input is rendered from the native TSX DDR-channel reproduction.
// Only the native process result is replaced to deterministically exercise GMRES failure.
const geometry = geometryFromCircuitJson(await nativeChannel(), modeling)
const cell = geometry.cells[0]
const signalR = cell.routedCopper!.signals[0].segments.reduce((sum,s) => sum + Math.hypot(...s.a.map((v,i)=>v-s.b[i])) * 1000 / ((s.conductivitySm??cell.conductivitySm)*s.widthMm*s.thicknessMm),0)
const matrix = `Row 1: N0a to N0b\nRow 2: N1a to N1b\nImpedance matrix for frequency = 1e+08 2 x 2\n${signalR} 1j 0 0j\n0 0j .01 1j\n`
const warning = 'Warning: Convergence not reached. Stopping iteration...'
const reachedCap = new Error('FasterCap reached')

type Setup = {phase?: 'coarse'|'refinement', stream?: 'stdout'|'stderr', extra?: string, retryFails?: boolean, retryBadMesh?: boolean, failure?: 'throw'|'exit'|'missing'}
function setup({phase,stream='stdout',extra='',retryFails=false,retryBadMesh=false,failure}:Setup = {}) {
  const calls: SolverRequest[] = [],files: FileMap = {}
  let segCount=0
  const solve: RunSolver = async request => {
    calls.push(request)
    if(request.solver==='fastercap') throw reachedCap
    const cube=request.args[1]==='cube'
    if(!cube) segCount++
    if(failure==='throw') throw new Error('native_timeout: interrupted')
    if(failure==='exit') return {stdout:warning,stderr:'',files:{'Zc.mat':matrix},exitCode:2}
    if(failure==='missing') return {stdout:warning,stderr:'',files:{} as FileMap}
    const failed=(cube && retryFails)||(!cube&&((phase==='coarse'&&segCount===1)||(phase==='refinement'&&segCount===2)))
    const resultMatrix=failed?'unconverged matrix':cube&&retryBadMesh?matrix.replace(`${signalR} 1j`,`${signalR*2} 1j`):matrix
    return {stdout:stream==='stdout'&&failed?`${warning}\n${extra}`:extra,stderr:stream==='stderr'&&failed?warning:'',files:{'Zc.mat':resultMatrix}}
  }
  return {calls,files,solve}
}

test('opt-in retries only failed segment solves and preserves selected provenance',async t=>{
  for(const phase of ['coarse','refinement'] as const) for(const stream of ['stdout','stderr'] as const) await t.test(`${phase} ${stream}`,async()=>{
    const {calls,files,solve}=setup({phase,stream})
    await assert.rejects(extractChannel(geometry,modeling,files,solve,()=>{},{fastHenryConvergenceRetry:'cube'}),error=>error===reachedCap)
    const henry=calls.filter(c=>c.solver==='fasthenry'),index=henry.findIndex(c=>c.args[1]==='cube')
    assert.equal(henry.length,3)
    assert.equal(index,phase==='coarse'?1:2)
    assert.equal(henry[index-1].args[1],'seg')
    assert.deepEqual(henry[index].files,henry[index-1].files)
    assert.deepEqual(henry[index].args,['-p','cube','channel.inp'])
    const dir=`stage-0${phase==='refinement'?'/refinement':''}`
    const original=JSON.parse(files[`${dir}/segment-attempt/fasthenry.request.json`]),selected=JSON.parse(files[`${dir}/fasthenry.request.json`])
    assert.equal(original.args[1],'seg');assert.equal(selected.args[1],'cube')
    assert.match(files[`${dir}/segment-attempt/fasthenry.${stream}.log`],/Convergence not reached/)
    assert.equal(files[`${dir}/segment-attempt/channel.inp`],files[`${dir}/channel.inp`])
    assert.equal(files[`${dir}/segment-attempt/Zc.mat`],'unconverged matrix')
    assert.equal(files[`${dir}/Zc.mat`],matrix)
    assert.equal(JSON.parse(files[`${dir}/fasthenry.retry.json`]).selectedPreconditioner,'cube')
  })
})

test('retry disabled by default; success never retries',async()=>{
  const first=setup({phase:'coarse'})
  await assert.rejects(extractChannel(geometry,modeling,first.files,first.solve),/native_convergence/)
  assert.equal(first.calls.length,1)
  const good=setup()
  await assert.rejects(extractChannel(geometry,modeling,good.files,good.solve,()=>{},{fastHenryConvergenceRetry:'cube'}),error=>error===reachedCap)
  assert.deepEqual(good.calls.map(c=>c.solver==='fasthenry'?c.args[1]:c.solver),['seg','seg','fastercap'])
  assert.equal(Object.keys(good.files).some(k=>k.includes('retry')),false)
})

test('failed retry is rejected; unrelated failures never retry',async t=>{
  const fail=setup({phase:'coarse',retryFails:true})
  await assert.rejects(extractChannel(geometry,modeling,fail.files,fail.solve,()=>{},{fastHenryConvergenceRetry:'cube'}),/native_convergence/)
  assert.deepEqual(fail.calls.map(c=>c.args[1]),['seg','cube'])
  for(const failure of ['throw','exit','missing'] as const) await t.test(failure,async()=>{
    const example=setup({failure})
    await assert.rejects(extractChannel(geometry,modeling,example.files,example.solve,()=>{},{fastHenryConvergenceRetry:'cube'}))
    assert.equal(example.calls.length,1)
  })
  const mixed=setup({phase:'coarse',extra:'Internal error in dist_betw_fils: D1D1 too small!'})
  await assert.rejects(extractChannel(geometry,modeling,mixed.files,mixed.solve,()=>{},{fastHenryConvergenceRetry:'cube'}))
  assert.equal(mixed.calls.length,1)
})

test('a converged cube solve cannot bypass mesh refinement checks',async()=>{
  const example=setup({phase:'refinement',retryBadMesh:true})
  await assert.rejects(extractChannel(geometry,modeling,example.files,example.solve,()=>{},{fastHenryConvergenceRetry:'cube'}),/mesh_convergence/)
  assert.deepEqual(example.calls.map(c=>c.args[1]),['seg','seg','cube'])
})
