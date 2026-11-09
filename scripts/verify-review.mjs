// Each invocation starts a fresh process: no restored or process-local field cache.
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
const root='runs/review-round1'
const cases=['single-ended','differential-data','crosstalk','crosstalk-quiet','multilayer']
if(process.argv[2]==='--case') {
  const name=process.argv[3]
  const base=name==='crosstalk-quiet'?'crosstalk':name
  const example=await import(`../examples/${base}/index.circuit.tsx`)
  const circuitJson=name===base?example.circuitJson:await example.makeBoard(true)
  const {runPipeline}=await import('../src/index.ts')
  const {loadIbisSources,createNativeSolver}=await import('../src/adapters/index.ts')
  const ibisSources=await loadIbisSources({circuitJson,baseDir:'runs/2d-models'})
  const native=createNativeSolver({tools:{ngspice:'/opt/homebrew/bin/ngspice'}})
  const start=performance.now()
  let extractionStart
  let extractionEnd
  let nativeInvocations=0
  try {
    const result=await runPipeline({circuitJson,modeling:example.modeling,ibisSources,onProgress:message=>{
      if(message==='Extract 2D channel')extractionStart=performance.now()
    },runSolver:async request=>{
      extractionEnd=performance.now()
      nativeInvocations++
      return native(request)
    }})
    console.log(JSON.stringify({name,status:'native-completed',pipelineSeconds:(performance.now()-start)/1000,extractionSeconds:(extractionEnd-extractionStart)/1000,nativeInvocations,files:result.files}))
  } catch(error) {
    console.log(JSON.stringify({name,status:'rejected-before-native',pipelineSeconds:(performance.now()-start)/1000,extractionSeconds:null,nativeInvocations,code:error.code,message:error.message}))
  }
} else {
  await mkdir(root,{recursive:true})
  const results=[]
  for(const name of cases)for(const repeat of [false,true]) {
    const row=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--import','tsx',import.meta.filename,'--case',name],{stdio:['ignore','pipe','inherit']})
      let output=''
      child.stdout.on('data',chunk=>{
        output+=chunk
      })
      child.once('error',reject)
      child.once('exit',code=>code===0?resolve(JSON.parse(output.trim().split('\n').at(-1))):reject(Error(`Worker ${name}: exit ${code}`)))
    })
    results.push({...row,repeat})
    await writeFile(`${root}/cold-attempts.json`,JSON.stringify(results,null,2)+'\n')
    console.log(JSON.stringify({...row,repeat}))
  }
}
