import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// A bounded clean-consumer check. It does not run extraction or native solvers.
const manager=process.argv[2]??'npm'
if(!['npm','pnpm'].includes(manager))throw Error('Use npm or pnpm')
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const output=resolve(process.argv[3]??`public-renderer-${manager}-result`)
mkdirSync(output,{recursive:true})
const temporary=mkdtempSync(join(tmpdir(),'pcb-public-renderer-'))
const report={manager,node:process.version,cases:[],sourceHashes:{},versions:{tscircuit:'0.0.3052',react:'19.2.4',tsx:'4.23.15'}}
function run(name,executable,args,timeout) {
  const start=performance.now()
  const child=spawnSync(executable,args,{cwd:temporary,encoding:'utf8',timeout,maxBuffer:8*1024*1024})
  writeFileSync(join(output,`${name}.log`),`${child.stdout??''}${child.stderr??''}`.replaceAll(temporary,'<temporary-consumer>'))
  const result={name,exitCode:child.status,signal:child.signal,error:child.error?.message,elapsedSeconds:(performance.now()-start)/1000}
  report.cases.push(result)
  console.log(JSON.stringify(result))
  return result
}
try {
  run('manager-version',manager,['--version'],10000)
  writeFileSync(join(temporary,'package.json'),JSON.stringify({name:'pcb-public-renderer-repro',private:true,type:'module',dependencies:report.versions},null,2))
  mkdirSync(join(temporary,'production'))
  for(const filename of ['tsx.ts','tsx-render.ts','matrices.mjs']) {
    const source=join(root,'src',filename)
    report.sourceHashes[filename]=createHash('sha256').update(readFileSync(source)).digest('hex')
    copyFileSync(source,join(temporary,'production',filename))
  }
  writeFileSync(join(temporary,'probe.mjs'),`
import assert from 'node:assert/strict'
import {Circuit} from 'tscircuit'
import {createElement as h} from 'react'
import {serializeSimulation} from './production/tsx.ts'
const circuit=new Circuit({platform:{partsEngineDisabled:true}})
circuit.add(h('board',{width:10,height:10,routingDisabled:true,schematicDisabled:true},
  h('resistor',{name:'R1',resistance:'1k',footprint:'0402'})))
await circuit.renderUntilSettled()
const before=circuit.getCircuitJson()
assert.ok(before.some(record=>record.type==='pcb_board'))
assert.ok(before.some(record=>record.type==='source_component'&&record.name==='R1'))
assert.ok(before.some(record=>record.type==='pcb_smtpad'))
assert.deepEqual(serializeSimulation(circuit),before)
console.log(JSON.stringify({stage:'public-renderer-and-native-serialization',records:before.length,boardCount:before.filter(r=>r.type==='pcb_board').length,sourceUnchanged:true,extractionRun:false}))
`)
  const args=manager==='npm'
    ?['install','--ignore-scripts','--no-audit','--no-fund']
    :['install','--ignore-scripts','--reporter=append-only']
  if(run('install',manager,args,180000).exitCode!==0)throw Error('Clean installation failed; see install.log')
  const lock=manager==='npm'?'package-lock.json':'pnpm-lock.yaml'
  copyFileSync(join(temporary,lock),join(output,lock))
  report.passed=run('render',process.execPath,['--max-old-space-size=1536','--import','tsx','probe.mjs'],60000).exitCode===0
  process.exitCode=report.passed?0:1
} catch(error) {
  report.error=String(error)
  process.exitCode=1
} finally {
  writeFileSync(join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
  rmSync(temporary,{recursive:true,force:true})
}
