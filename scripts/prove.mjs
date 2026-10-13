import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { resolve,join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEntry,runPipeline,sha256 } from '../src/pipeline.mjs'
import { analyticCapacitanceCheck } from './validate-capacitance.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile)
const output=resolve(process.argv[2]??join(root,'runs',`proof-${Date.now()}`))
await mkdir(output)
const tools=JSON.parse(await readFile(process.env.PCB_SPICE_TOOLS??join(root,'.cache/tools/tools.json')))
const summary={status:'running',output,analyticCapacitance:await analyticCapacitanceCheck(tools.fastercap,join(output,'analytic-capacitance')),examples:{}}
for(const name of ['straight','am3352','tsx']) {
  const entry=join(root,'examples',name==='tsx'?'board.tsx':`${name}.json`),receipts=[]
  for(const repetition of ['a','b']) {
    console.log(`Prove ${name} regeneration ${repetition}`)
    const out=join(output,`${name}-${repetition}`)
    if(name==='tsx') {
      const result=await exec(process.execPath,['--import','tsx',join(root,'src/cli.mjs'),entry,'--out',out],{cwd:root,timeout:300000,maxBuffer:4*1024*1024})
      console.log(result.stdout.trim())
      await writeFile(join(output,`tsx-${repetition}.stdout.log`),result.stdout)
      await writeFile(join(output,`tsx-${repetition}.stderr.log`),result.stderr)
      receipts.push(JSON.parse(await readFile(join(out,'receipt.json'))))
    } else receipts.push(await runPipeline({...await loadEntry(entry),outputDir:out,tools,onProgress:console.log}))
  }
  const [a,b]=receipts,paths=['channel.cir','simulation.cir','driver.lib','receiver.lib','waveform.csv','metrics.json','inputs/circuit.json']
  for(const e of a.matrices) paths.push(`stage-${e.stage}/Zc.mat`,`stage-${e.stage}/channel.csv`)
  if(name==='tsx') {
    if(!a.nativeIbis?.driver?.usedNativeSourceForSimulation||!b.nativeIbis?.receiver?.usedNativeSourceForSimulation) throw new Error('TSX must use actual native emitted model source/mapping')
    paths.push('native-ibis-assembly.json')
  }
  const compared=paths.map(path=>({path,sha256:a.files[path],identical:a.files[path]===b.files[path]}))
  if(compared.some(c=>!c.identical)) throw new Error(`${name}: regenerated solver matrix/netlist/waveform differs; see both fresh runs`)
  summary.examples[name]={regeneratedTwice:true,byteIdentical:compared,metrics:a.metrics,receipts:[`${name}-a/receipt.json`,`${name}-b/receipt.json`]}
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n')
}
summary.status='passed'
summary.inputPackageSha256=sha256(await readFile(join(root,'vendor/ibis-to-spice-0.0.1.tgz')))
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n')
console.log(`Proof passed: ${join(output,'summary.json')}`)
