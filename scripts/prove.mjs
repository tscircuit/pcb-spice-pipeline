import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { resolve,join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEntry,runPipeline,sha256 } from '../src/pipeline.mjs'
import { analyticCapacitanceCheck } from './validate-capacitance.mjs'
import { auditRun, compareFreshRuns } from './audit-eye.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile)
const args=process.argv.slice(2),output=resolve(args.find(arg=>arg!=='--all')??join(root,'runs',`proof-${Date.now()}`))
await mkdir(dirname(output),{recursive:true})
await mkdir(output)
const tools=JSON.parse(await readFile(process.env.PCB_SPICE_TOOLS??join(root,'.cache/tools/tools.json')))
const summary={schemaVersion:2,status:'running',output,solverResultsReused:false,analyticCapacitance:await analyticCapacitanceCheck(tools.fastercap,join(output,'analytic-capacitance')),examples:{}}
const examples=args.includes('--all')?['straight','am3352','tsx','am3352-eye']:['am3352-eye']
for(const name of examples) {
  const entry=join(root,'examples',name==='tsx'?'board.tsx':name==='am3352-eye'?'am3352-eye.tsx':`${name}.json`),receipts=[],commands=[]
  for(const repetition of ['a','b']) {
    console.log(`Prove ${name} regeneration ${repetition}`)
    const out=join(output,`${name}-${repetition}`)
    if(entry.endsWith('.tsx')) {
      const result=await exec(process.execPath,['--import','tsx',join(root,'src/cli.mjs'),entry,'--out',out],{cwd:root,timeout:300000,maxBuffer:4*1024*1024})
      console.log(result.stdout.trim())
      await writeFile(join(output,`${name}-${repetition}.stdout.log`),result.stdout)
      await writeFile(join(output,`${name}-${repetition}.stderr.log`),result.stderr)
      receipts.push(JSON.parse(await readFile(join(out,'receipt.json'))))
    } else receipts.push(await runPipeline({...await loadEntry(entry),outputDir:out,tools,onProgress:console.log}))
  }
  const [a,b]=receipts,paths=['channel.cir','simulation.cir','driver.lib','receiver.lib','waveform.csv','metrics.json','inputs/circuit.json','inputs/modeling.json','geometry.json','rendered-board.json','eyediagram.json','eye-data.csv','eye-data.json','eye.png','eye.svg','waveform.png','waveform.svg']
  if(JSON.stringify(a.sourceFiles)!==JSON.stringify(b.sourceFiles)) throw new Error('Source changed between proof runs')
  for(const e of a.matrices) paths.push(`stage-${e.stage}/Zc.mat`,`stage-${e.stage}/channel.csv`,`stage-${e.stage}/refinement/Zc.mat`,`stage-${e.stage}/extraction.json`)
  if(entry.endsWith('.tsx')) {
    if(!a.nativeIbis?.driver?.usedNativeSourceForSimulation||!b.nativeIbis?.receiver?.usedNativeSourceForSimulation) throw new Error('TSX must use actual native emitted model source/mapping')
    paths.push('native-ibis-assembly.json')
  }
  if(name==='am3352-eye'&&[a,b].some(r=>r.eyeDiagram?.origin!=='native-tsx-element')) throw new Error('Real board proof requires executed native <eyediagram>')
  for(const [index,r] of receipts.entries()) {
    if(r.execution.solverResultCache!==false) throw new Error('Solver cache policy must be explicit')
    const nativePaths=['ngspice.command.json',...r.matrices.flatMap(e=>[`stage-${e.stage}/fasthenry.command.json`,`stage-${e.stage}/refinement/fasthenry.command.json`,`stage-${e.stage}/fastercap.command.json`])]
    const records=[]
    for(const path of nativePaths) {
      const record=JSON.parse(await readFile(join(output,`${name}-${index===0?'a':'b'}`,path)))
      if(record.exitCode!==0||!record.cwd.startsWith(join(output,`${name}-${index===0?'a':'b'}`))) throw new Error(`Missing fresh successful solver execution: ${path}`)
      records.push({path,...record})
    }
    commands.push(records)
  }
  const compared=paths.map(path=>({path,sha256:a.files[path],identical:Boolean(a.files[path])&&a.files[path]===b.files[path]}))
  if(compared.some(c=>!c.identical)) throw new Error(`${name}: regenerated solver matrix/netlist/waveform differs; see both fresh runs`)
  summary.examples[name]={entry,regeneratedTwice:true,freshSolverCommands:commands,byteIdentical:compared,metrics:a.metrics,eyeDiagram:a.eyeDiagram,receipts:[`${name}-a/receipt.json`,`${name}-b/receipt.json`]}
  if(name==='am3352-eye') {
    console.log('Independently audit both real-board runs, raw matrices, original routes and every folded eye sample')
    const aDir=join(output,`${name}-a`),bDir=join(output,`${name}-b`)
    const audit={status:'passed',runs:[await auditRun(aDir),await auditRun(bDir)],repeatability:await compareFreshRuns(aDir,bDir)}
    await writeFile(join(output,'independent-audit.json'),JSON.stringify(audit,null,2)+'\n')
    summary.examples[name].independentAudit={status:'passed',report:'independent-audit.json'}
  }
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n')
}
summary.status='passed'
summary.inputPackageSha256=sha256(await readFile(join(root,'vendor/ibis-to-spice-0.0.1.tgz')))
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n')
console.log(`Proof passed: ${join(output,'summary.json')}`)
