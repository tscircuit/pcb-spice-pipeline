import {performance} from 'node:perf_hooks'
import {mkdir,writeFile} from 'node:fs/promises'
import {runPipeline} from '../src/index'
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '../src/adapters/index'
import {measureMutual} from './measure-mutual.mjs'
const native=createNativeSolver({tools:{ngspice:'/opt/homebrew/bin/ngspice'}})
// Output/repeat controls belong to this evidence script, not the extraction API.
const root=process.env.SI_MEASUREMENT_DIRECTORY??'runs/qualified'
const names=process.argv.slice(2)
const failures=[]
for(const name of names.length?names:['single-ended','differential-data','crosstalk','crosstalk-quiet','multilayer']) {
  try {
  const base=name==='crosstalk-quiet'?'crosstalk':name==='single-package'?'single-ended':name
  const example=await import(`../examples/${base}/index.circuit.tsx`)
  const circuitJson=name===base?example.circuitJson:await example.makeBoard(true)
  const modeling=example.modeling
  const ibisSources=await loadIbisSources({circuitJson,baseDir:'runs/2d-models'})
  const measurements=[]
  const results=[]
  const requests=[]
  const outputs=[]
  for(const repeat of [false,true]) {
    const started=performance.now()
    let extractionStart
    let extractionEnd
    let nativeSeconds=0
    const invocationRequests=[]
    const invocationOutputs=[]
    const result=await runPipeline({circuitJson,modeling,ibisSources,
      onProgress:message=>{
        console.log(`${name}${repeat?' repeat':''}: ${message}`)
        if(message==='Extract 2D channel'&&extractionStart===undefined)extractionStart=performance.now()
      },
      runSolver:async request=>{
        if(request.solver!=='ngspice')throw new Error('3D extraction is forbidden')
        extractionEnd=performance.now()
        const start=performance.now()
        const directory=`${root}-requests/${name}${repeat?'-repeat':''}`
        await mkdir(directory,{recursive:true})
        for(const [file,body] of Object.entries(request.files))await writeFile(`${directory}/${file}`,body)
        const output=await native(request)
        await writeFile(`${directory}/stdout.log`,output.stdout)
        await writeFile(`${directory}/stderr.log`,output.stderr)
        nativeSeconds+=(performance.now()-start)/1000
        invocationRequests.push(request)
        invocationOutputs.push(output)
        return output
      },
    })
    await writePipelineOutput({result,outputDir:`${root}/${name}${repeat?'-repeat':''}`})
    measurements.push({repeat,totalSeconds:(performance.now()-started)/1000,extractionSeconds:(extractionEnd-extractionStart)/1000,nativeSeconds})
    results.push(result)
    requests.push(invocationRequests)
    outputs.push(invocationOutputs)
  }
  const changedFiles=[...new Set([...Object.keys(results[0].files),...Object.keys(results[1].files)])].filter(p=>results[0].files[p]!==results[1].files[p])
  const summary={name,measurements,segments:results[0].matrices.length,uniqueSlices:new Set(results[0].matrices.map(m=>m.sliceHash)).size,
    cells:results[0].matrices.reduce((sum,m)=>sum+m.cells,0),bitIdentical:changedFiles.length===0,changedFiles,
    nativeRequestsIdentical:JSON.stringify(requests[0])===JSON.stringify(requests[1])}
  if(base==='differential-data')summary.signedMutualL=measureMutual(results[0].matrices,'A','B',0,1)
  if(base==='crosstalk') {
    // Identical native input proves a permutation cannot affect the electrical solve; replay
    // the measured output only after exact request equality. Both ordinary repeats above are native.
    let index=0
    const permuted=await runPipeline({circuitJson,modeling:{...modeling,lanes:[...modeling.lanes].reverse()},ibisSources,runSolver:async request=>{
      if(JSON.stringify(request)!==JSON.stringify(requests[0][index]))throw new Error('lane_order_native_request_changed')
      return outputs[0][index++]
    }})
    summary.permutationNativeRequestIdentical=true
    summary.permutationMatricesIdentical=JSON.stringify(permuted.matrices)===JSON.stringify(results[0].matrices)
    summary.crosstalk=results[0].experiments.flatMap(e=>e.probes.map(p=>({probe:p.name,peakAbsoluteV:e.waveform.rows.filter(r=>r[0]>=e.eyes[0].startTimeSeconds).reduce((peak,row)=>Math.max(peak,Math.abs(row[p.column])),0)})))
  }
  await writeFile(`${root}/${name}/summary.json`,JSON.stringify(summary,null,2))
  console.log(JSON.stringify(summary,null,2))
  if(!summary.bitIdentical||!summary.nativeRequestsIdentical)throw new Error(`repeat_changed: ${name}: ${changedFiles.join(', ')}`)
  } catch(error) {
    const failure={name,code:error.code??error.name,message:error.message,stack:error.stack}
    await mkdir(`${root}/${name}`,{recursive:true})
    await writeFile(`${root}/${name}/failure.json`,JSON.stringify(failure,null,2))
    console.error(JSON.stringify(failure,null,2))
    failures.push(error)
  }
}
if(failures.length)throw new AggregateError(failures,`measurement_failed: ${failures.length} board(s); see ${root}/*/failure.json`)
