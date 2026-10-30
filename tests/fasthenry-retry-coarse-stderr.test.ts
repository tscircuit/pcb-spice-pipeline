import test from 'node:test'
import assert from 'node:assert/strict'
import { extractChannel } from '../src/extraction.js'
import { geometry, modeling, setup, reachedCap, matrix } from './fixtures/fasthenry-retry.js'

test('coarse stderr convergence warning retries with cube and preserves provenance', async () => {
  const phase = 'coarse'
  const stream = 'stderr'
  const {calls,files,solve}=setup({phase,stream})
  await assert.rejects(extractChannel(geometry,modeling,files,solve,()=>{},{fastHenryConvergenceRetry:'cube'}),error=>error===reachedCap)
  const henry=calls.filter(c=>c.solver==='fasthenry'),index=henry.findIndex(c=>c.args[1]==='cube')
  assert.equal(henry.length,3)
  assert.equal(index,1)
  assert.equal(henry[index-1].args[1],'seg')
  assert.deepEqual(henry[index].files,henry[index-1].files)
  assert.deepEqual(henry[index].args,['-p','cube','channel.inp'])
  const dir='stage-0'
  const original=JSON.parse(files[`${dir}/segment-attempt/fasthenry.request.json`]),selected=JSON.parse(files[`${dir}/fasthenry.request.json`])
  assert.equal(original.args[1],'seg');assert.equal(selected.args[1],'cube')
  assert.match(files[`${dir}/segment-attempt/fasthenry.${stream}.log`],/Convergence not reached/)
  assert.equal(files[`${dir}/segment-attempt/channel.inp`],files[`${dir}/channel.inp`])
  assert.equal(files[`${dir}/segment-attempt/Zc.mat`],'unconverged matrix')
  assert.equal(files[`${dir}/Zc.mat`],matrix)
  assert.equal(JSON.parse(files[`${dir}/fasthenry.retry.json`]).selectedPreconditioner,'cube')
})
