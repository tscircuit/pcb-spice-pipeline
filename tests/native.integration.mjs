import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {loadEntry,runPipeline} from '../src/pipeline.mjs'
import {analyticCapacitanceCheck} from '../scripts/validate-capacitance.mjs'
test('native solvers regenerate geometry, analytically check it and simulate distinct external pads',async()=>{
  const root=new URL('..',import.meta.url).pathname,output=join(root,'runs',`native-test-${Date.now()}`)
  const tools=JSON.parse(await readFile(join(root,'.cache/tools/tools.json')))
  const r=await runPipeline({...await loadEntry(join(root,'examples/straight.json')),outputDir:output,tools})
  assert.equal(r.status,'executed');assert.ok(r.metrics.receiverTransitions>=20)
  assert.ok(r.metrics.eyeHeightAtCenterV>0);assert.ok(r.metrics.propagationMedianSeconds>0)
  const extraction=JSON.parse(await readFile(join(output,'stage-0/extraction.json')))
  assert.ok(extraction.checks.dcLoopResidual<.002);assert.ok(extraction.checks.energyResidual<1e-10);assert.ok(extraction.checks.neutralityResidual<1e-10)
  assert.notEqual(extraction.R[0][1],0)
  for(const command of ['stage-0/fasthenry','stage-0/fastercap','ngspice','plot']) assert.equal(JSON.parse(await readFile(join(output,`${command}.command.json`))).exitCode,0)
  const net=await readFile(join(output,'simulation.cir'),'utf8')
  assert.match(net,/XCHAN drv0 drv1 rx0 rx1 0 CHANNEL/)
  assert.match(net,/XDRIVER drv0 drv1 vdd 0/);assert.match(net,/XRECEIVER rx0 rx1 vdd 0/)
  const cap=await analyticCapacitanceCheck(tools.fastercap,join(output,'independent-analytic-cap'))
  assert.ok(cap.relativeError<.05)
})
