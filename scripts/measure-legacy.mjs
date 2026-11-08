// BEFORE evidence only. This imports the reproduction checkout's removed 3D extractor.
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {performance} from 'node:perf_hooks'
import {writeFile} from 'node:fs/promises'
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '../src/adapters/index'
const checkout=process.argv[2]
if(!checkout)throw new Error('baseline_checkout: supply an absolute checkout of si-2d/repro')
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim()
if(head!=='8a85951c6cd6b1ebd76c8dca3ea8e89d585446a9')throw new Error(`baseline_checkout: expected the reproduction commit, found ${head}`)
const {runPipeline}=await import(pathToFileURL(resolve(checkout,'src/index.ts')).href)
const {modeling:legacy}=await import(pathToFileURL(resolve(checkout,'examples/single-ended/simulation.config.ts')).href)
const native=createNativeSolver({tools:{ngspice:'/opt/homebrew/bin/ngspice',fasthenry:'/opt/homebrew/bin/fasthenry',fastercap:'/opt/homebrew/bin/FasterCap'}})
const names=process.argv.slice(3)
for(const name of names.length?names:['single-ended','differential-data','crosstalk','multilayer']) {
  const existing=['single-ended','differential-data'].includes(name)
  const example=await import(existing?pathToFileURL(resolve(checkout,`examples/${name}/index.circuit.tsx`)).href:`../examples/${name}/index.circuit.tsx`)
  const modeling=existing?example.modeling:{...legacy,...example.modeling,profiles:name==='multilayer'?{via:legacy.profiles.top}:{},
    channelReference:{component:name==='crosstalk'?'TX0':'TX',port:'GND'},
    // Old extractor requires these numerical via controls. They are absent from the new API.
    viaPlatingMm:.025,viaEquivalentWidthMm:Math.PI*(.3+.025),omitThroughViaStubs:true}
  const {circuitJson}=example
  const ibisSources=await loadIbisSources({circuitJson,baseDir:'runs/2d-models'})
  const started=performance.now()
  let extractionStart
  let extractionEnd
  let ngspiceSeconds=0
  const result=await runPipeline({circuitJson,modeling,ibisSources,onProgress:message=>console.log(name,message),runSolver:async request=>{
    if(request.solver==='ngspice')extractionEnd=performance.now()
    else if(extractionStart===undefined)extractionStart=performance.now()
    const start=performance.now()
    const result=await native(request)
    if(request.solver==='ngspice')ngspiceSeconds+=(performance.now()-start)/1000
    return result
  }})
  await writePipelineOutput({result,outputDir:`runs/before-eyes/${name}`})
  const summary={name,totalSeconds:(performance.now()-started)/1000,extractionSeconds:(extractionEnd-extractionStart)/1000,ngspiceSeconds}
  await writeFile(`runs/before-eyes/${name}/summary.json`,JSON.stringify(summary,null,2))
  console.log(JSON.stringify(summary,null,2))
}
