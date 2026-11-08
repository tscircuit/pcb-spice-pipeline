import test from 'node:test'
import assert from 'node:assert/strict'
import { extractionBand } from '../../src/buffers'
test('missing bit timing has a named diagnostic rather than a guessed band', () => {
  assert.throws(() => extractionBand([],[]),{code:'ibis_edge'})
})

test('passive experiments use an explicit physical pulse edge and refuse a timestep guess',()=>{
  const timing=[{eyes:[{unitIntervalSeconds:50e-9}]}]
  assert.throws(()=>extractionBand([],timing),{code:'ibis_edge'})
  const band=extractionBand([],timing,[{wave_shape:'square',rise_time:1e-6,fall_time:2e-6}])
  assert.ok(Math.abs(band.riseTimeSeconds/.8e-9-1)<1e-14)
  assert.equal(band.bitRateHz,20e6)
})
