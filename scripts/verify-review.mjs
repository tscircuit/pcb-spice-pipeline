// Every worker is a fresh process with no restored field cache. This harness imposes no solver limit.
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const root=process.env.SI_REVIEW_DIRECTORY??'runs/review-round2'
const cases=process.env.SI_REVIEW_CASES?.split(',')??['single-ended','differential-data','crosstalk','crosstalk-quiet','multilayer']
if(process.argv[2]==='--case') {
  const name=process.argv[3]
  const repeat=process.argv[4]==='repeat'
  const directory=`${root}/${name}${repeat?'-repeat':''}`
  await mkdir(directory,{recursive:true})
  const base=name==='crosstalk-quiet'?'crosstalk':name
  const example=await import(`../examples/${base}/index.circuit.tsx`)
  const circuitJson=name===base?example.circuitJson:await example.makeBoard(true)
  const {runPipeline}=await import('../src/index.ts')
  const {loadIbisSources,createNativeSolver,writePipelineOutput}=await import('../src/adapters/index.ts')
  const ibisSources=await loadIbisSources({circuitJson,baseDir:'runs/2d-models'})
  const native=createNativeSolver({tools:{ngspice:'/opt/homebrew/bin/ngspice'}})
  const start=performance.now()
  const progress=[]
  const slices=[]
  let slice
  let extractionStart
  let extractionEnd
  let nativeInvocations=0
  let nativeSeconds=0
  let requestHash
  let row
  try {
    const result=await runPipeline({circuitJson,modeling:example.modeling,ibisSources,onProgress:message=>{
      const seconds=(performance.now()-start)/1000
      console.error(`${name}: ${seconds.toFixed(3)}s ${message}`)
      progress.push({seconds,message})
      if(message==='Extract 2D channel')extractionStart=performance.now()
      if(/: solve slice /.test(message))slice={start:seconds,message}
      if(slice&&/: automatic /.test(message)) {
        slices.push({...slice,seconds:seconds-slice.start})
        slice=undefined
      }
    },runSolver:async request=>{
      extractionEnd??=performance.now()
      nativeInvocations++
      requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex')
      for(const [name,body] of Object.entries(request.files))await writeFile(`${directory}/${name}`,body)
      const before=performance.now()
      const output=await native(request)
      nativeSeconds+=(performance.now()-before)/1000
      await writeFile(`${directory}/native.stdout.log`,output.stdout)
      await writeFile(`${directory}/native.stderr.log`,output.stderr)
      return output
    }})
    await writePipelineOutput({result,outputDir:directory})
    const hashes=Object.fromEntries(Object.entries(result.files).map(([path,body])=>[path,createHash('sha256').update(body).digest('hex')]))
    row={name,repeat,status:'native-completed',pipelineSeconds:(performance.now()-start)/1000,extractionSeconds:(extractionEnd-extractionStart)/1000,nativeSeconds,nativeInvocations,requestHash,hashes,
      maximumSliceSeconds:Math.max(...slices.map(s=>s.seconds)),segments:result.matrices.length,eyes:result.experiments.flatMap(e=>e.eyes.map(eye=>({name:eye.name,metrics:eye.metrics}))),
      crosstalk:result.experiments.flatMap(e=>e.probes.map(p=>({probe:p.name,peakAbsoluteV:e.waveform.rows.filter(r=>r[0]>=e.eyes[0].startTimeSeconds).reduce((peak,r)=>Math.max(peak,Math.abs(r[p.column])),0)})))}
  } catch(error) {
    row={name,repeat,status:nativeInvocations?'native-failed':extractionStart?'extraction-failed':'geometry-rejected',pipelineSeconds:(performance.now()-start)/1000,extractionSeconds:extractionEnd?(extractionEnd-extractionStart)/1000:null,nativeInvocations,code:error.code,message:error.message}
  }
  await writeFile(`${directory}/progress.json`,JSON.stringify({progress,slices},null,2)+'\n')
  await writeFile(`${directory}/summary.json`,JSON.stringify(row,null,2)+'\n')
  console.log(JSON.stringify(row))
} else {
  await mkdir(root,{recursive:true})
  const results=[]
  for(const name of cases)for(const repeat of [false,true]) {
    const row=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--import','tsx',import.meta.filename,'--case',name,...(repeat?['repeat']:[])],{stdio:['ignore','pipe','inherit'],env:process.env})
      let output=''
      child.stdout.on('data',chunk=>{
        output+=chunk
      })
      child.once('error',reject)
      child.once('exit',code=>code===0?resolve(JSON.parse(output.trim().split('\n').at(-1))):reject(Error(`Worker ${name}: exit ${code}`)))
    })
    results.push(row)
    await writeFile(`${root}/cold-attempts.json`,JSON.stringify(results,null,2)+'\n')
    console.log(JSON.stringify(row))
  }
  for(const name of cases) {
    const [a,b]=results.filter(r=>r.name===name)
    console.log(JSON.stringify({name,nativeDeterminism:a.status==='native-completed'&&b.status==='native-completed'?JSON.stringify(a.hashes)===JSON.stringify(b.hashes):null,diagnosticDeterminism:a.code===b.code&&a.message===b.message}))
  }
}
