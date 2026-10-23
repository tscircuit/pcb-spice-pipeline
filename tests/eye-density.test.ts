import test from 'node:test'
import assert from 'node:assert/strict'
import {eyeDensity, eyeSampling} from '../src/eye-density.js'
import {generateReportData} from '../src/viewer.js'

const eye = {unitIntervalSeconds:1, startTimeSeconds:0, endTimeSeconds:4, windowOriginsSeconds:[0,2]}
const rows = [[0,0],[1,1],[2,0],[3,1],[4,0]]
const bounds = {width:4, height:4, yMin:0, yMax:1}

test('density is independent of adaptive sample concentration and counts each trace at most once per bin', () => {
  const sparse = eyeDensity(rows, 1, eye, bounds)
  const adaptive = eyeDensity([[0,0],[.1,.1],[.12,.12],[.2,.2],[1,1],[2,0],[3,1],[4,0]], 1, eye, bounds)
  assert.deepEqual(adaptive.counts, sparse.counts)
  assert.ok(sparse.counts.some(n=>n===2))
  assert.ok(sparse.counts.every(n=>n<=2))
})

test('density retains a narrow recorded spike between time-bin centers', () => {
  const spike = eyeDensity([[0,0],[.49,0],[.5,1],[.51,0],[2,0]], 1, {...eye,windowOriginsSeconds:[0]}, {width:2,height:4,yMin:0,yMax:1})
  assert.equal(spike.counts[0], 1, 'the recorded peak intersects the highest voltage bin')
})

test('only complete gated windows contribute and display resolution never inflates recorded sample counts', () => {
  const incomplete = {...eye, windowOriginsSeconds:[-1,0,2,3,NaN]}
  const a = eyeDensity(rows, 1, incomplete, bounds)
  const b = eyeDensity(rows, 1, incomplete, {...bounds,width:40})
  assert.deepEqual(a.sampling.windowOriginsSeconds, [0,2])
  assert.equal(a.sampling.completeWindows, 2)
  assert.equal(a.sampling.rejectedWindows, 3)
  assert.equal(a.sampling.actualSamples, 5)
  assert.equal(a.sampling.actualSamplesInGate, 5)
  assert.equal(a.sampling.minimumSamplesPerWindow, 3)
  assert.equal(a.sampling.maxGapUi, 1)
  assert.deepEqual(a.sampling, b.sampling)
  assert.equal(eyeSampling(rows, {...eye, startTimeSeconds:1}).completeWindows, 1)
  assert.equal(eyeSampling(rows, {...eye, windowOriginsSeconds:[0,0,2]}).rejectedWindows, 1)
})

test('missing origins are unavailable, truncated gates are flagged, and gaps spanning a gate remain visible', () => {
  assert.equal(eyeSampling(rows, {unitIntervalSeconds:1}).completeWindows, null)
  assert.equal(eyeSampling(rows.slice(0,-1), eye).gateFullyRecorded, false)
  assert.equal(eyeSampling([[0,0],[30,1]], {unitIntervalSeconds:1,startTimeSeconds:10,endTimeSeconds:20}).maxGapSeconds, 10)
  assert.equal(eyeSampling([], eye).completeWindows, 0)
  assert.throws(()=>eyeSampling(rows, {...eye,unitIntervalSeconds:0}), /UI/)
  assert.throws(()=>eyeSampling([[0,0],[0,1]], eye), /timestamps/)
  assert.throws(()=>eyeDensity(rows,1,eye,{...bounds,width:Infinity}), /dimensions/)
  assert.throws(()=>eyeDensity(rows,1,eye,{...bounds,xMax:3}), /bounds/)
})

test('report exposes recorded sampling evidence without altering waveform data', () => {
  const output = generateReportData({runs:[{name:'Native',rows,probes:[{name:'P',column:1,simulationVoltageProbeId:'p'}],
    eyes:[{...eye,name:'P eye',simulationVoltageProbeId:'p',windows:999}]}],limitations:[]})
  assert.match(output['results.html'], /Eye style/)
  assert.match(output['results.html'], /Minimum actual samples\/window/)
  const csv = output['csv/eye-summary.csv'].trim().split('\n').map(line=>line.split(','))
  assert.equal(csv[1][7], '2', 'recount complete windows rather than trusting cached display counts')
  assert.equal(csv[1][10], '5')
  assert.equal(csv[1][11], '5')
  assert.match(output['csv/01-native-waveforms.csv'], /0,0\n1,1\n2,0\n3,1\n4,0\n/)
})
