import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm,access,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import React from 'react'

const exec=promisify(execFile)
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=await mkdtemp(join(tmpdir(),'pcb-package-'))
const run=async(executable,args,cwd)=>{
  try{
    return await exec(executable,args,{cwd,timeout:180000,maxBuffer:8*1024*1024})
  }
  catch(error){throw Error(`${executable} ${args.join(' ')}\n${error.stdout??''}\n${error.stderr??error.message}`)}
}
try {
  const packed=JSON.parse((await run('npm',['pack','--json','--pack-destination',temporary],root)).stdout)[0]
  assert.ok(packed.files.every(file=>file.path.startsWith('dist/')||['README.md','LICENSE','package.json'].includes(file.path)))
  assert.ok(!packed.files.some(file=>/dist\/(?:setup|runtime|cli|pipeline)\./.test(file.path)))
  const consumer=join(temporary,'consumer')
  await mkdir(consumer)
  await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
  await run('npm',['install','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund',join(temporary,packed.filename)],consumer)
  const installed=join(consumer,'node_modules/@tscircuit/signal-integrity-pipeline')
  await assert.rejects(access(join(installed,'src')),{code:'ENOENT'})
  await assert.rejects(access(join(consumer,'node_modules/react')),{code:'ENOENT'})
  // circuit-json is a peer: the package never installs its own copy into a host tree.
  await assert.rejects(access(join(consumer,'node_modules/circuit-json')),{code:'ENOENT'})
  // Hosts supply circuit-json, as tscircuit does for core and the other converters.
  const circuitJsonVersion=JSON.parse(await readFile(join(root,'package.json'),'utf8')).devDependencies['circuit-json']
  await run('npm',['install','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund',`circuit-json@${circuitJsonVersion}`],consumer)
  // Until circuit-json#983 is released, exercise the exact locally built peer schemas.
  if(process.env.SI_LOCAL_CIRCUIT_JSON_DIST){
    for(const file of ['index.mjs','index.d.mts'])await copyFile(join(process.env.SI_LOCAL_CIRCUIT_JSON_DIST,file),join(consumer,'node_modules/circuit-json/dist',file))
  }
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'))
  assert.equal(manifest.name,'@tscircuit/signal-integrity-pipeline')
  assert.equal(manifest.main,'./dist/index.js')
  assert.equal(manifest.types,'./dist/index.d.ts')
  assert.equal(manifest.scripts.prepare,undefined)
  assert.ok(Object.values(manifest.peerDependenciesMeta).every(peer=>peer.optional))
  // Real vendor bytes are optional for package portability checks; never substitute invented IBIS.
  const input={circuitJson:[],ibisSources:{}}
  if(process.env.IBIS_MODEL_DIR){
    const {renderSignals}=await import('../tests/support/signal-render.tsx')
    const {default:Single}=await import('../examples/levels/level1-single-ended.tsx')
    input.circuitJson=(await renderSignals(React.createElement(Single))).filter(record=>record.type!=='pcb_trace')
    for(const record of input.circuitJson)if(record.type==='simulation_signal_integrity')record.unrouted='ideal'
    input.ibisSources['models/sn74lvc1g04.ibs']=await readFile(join(process.env.IBIS_MODEL_DIR,'sn74lvc1g04.ibs'),'utf8')
  }
  await writeFile(join(consumer,'input.json'),JSON.stringify(input))
  // Canned waveform checks the packaged IO boundary, not solver physics. Native evidence is separate.
  await writeFile(join(consumer,'solver.mjs'),`export async function fixtureSolver(request){
    if(request.solver!=='ngspice')throw Error('Ideal copper should require no extraction');
    const end=Number(request.files['simulation.cir'].match(/^tran +\\S+ +(\\S+)/m)[1]);
    return {stdout:'',stderr:'',files:{'waveform.dat':'time voltage\\n'+Array.from({length:961},(_,i)=>[i*end/960,end<2e-6?0:3.3*(Math.floor(i/20)%2)].join(' ')).join('\\n')+'\\n'}};
  }`)
  const smoke=`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runPipeline,generateReport} from '@tscircuit/signal-integrity-pipeline';
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '@tscircuit/signal-integrity-pipeline/node';
import {fixtureSolver} from './solver.mjs';
const input=JSON.parse(readFileSync('input.json','utf8'));
await assert.rejects(runPipeline({...input,modeling:{},runSolver:fixtureSolver}),{code:'signal_integrity_input'});
if(input.circuitJson.length){const result=await runPipeline({...input,runSolver:fixtureSolver});assert.equal(result.blocks.length,1);assert.ok(result.blocks[0].results.some(r=>r.type==='simulation_signal_eye'));assert.ok(generateReport(result)['results.html']);}
else assert.deepEqual((await runPipeline({...input,runSolver:fixtureSolver})).blocks,[]);
assert.equal(typeof createNativeSolver,'function');assert.equal(typeof loadIbisSources,'function');assert.equal(typeof writePipelineOutput,'function');`
  await writeFile(join(consumer,'smoke.mjs'),smoke)
  await run(process.execPath,['smoke.mjs'],consumer)
  console.log(`Packed Node exports/removal contract: passed; real-IBIS in-memory run: ${input.circuitJson.length?'passed with canned waveform':'skipped (set IBIS_MODEL_DIR)'}; no source tree or implicit peers`)
  const denied=(await readFile(join(root,'tests/denied-host.mjs'),'utf8'))
    .replace("'./fixtures/solver.mjs'","'./solver.mjs'").replace("'../dist/index.js'","'@tscircuit/signal-integrity-pipeline'")
  await writeFile(join(consumer,'denied-host.mjs'),denied.replace("readFileSync(0,'utf8')","readFileSync('input.json','utf8')"))
  await run(process.execPath,['denied-host.mjs'],consumer)
  console.log('Packed cold import + run with host actions denied: passed')
  await writeFile(join(consumer,'types.mts'),`import {runPipeline,generateReport,type PipelineOptions,type SolverRequest} from '@tscircuit/signal-integrity-pipeline';
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '@tscircuit/signal-integrity-pipeline/node';
import type {CircuitJson} from 'circuit-json';
const execute=async(options:PipelineOptions)=>{const result=await runPipeline(options);const html:string=generateReport(result)['results.html'];await writePipelineOutput({result,outputDir:html})};
const solver=createNativeSolver();const request:SolverRequest={solver:'ngspice',files:{},args:[],outputFiles:[]};
const circuitJson:CircuitJson=[{type:'pcb_quote_estimate',pcb_quote_estimate_id:'quote',pcb_board_id:'board',supplier_name:'test supplier',currency:'USD',quantity:1,estimated_at:'2026-11-02T00:00:00Z',is_manufacturing_cost_complete:false,is_landed_cost_complete:false}];
const simulate=async(circuitJson:CircuitJson)=>runPipeline({circuitJson,ibisSources:await loadIbisSources({circuitJson,baseDir:'.'}),runSolver:solver});
void execute;void request;void circuitJson;void simulate;`)
  await run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','false','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','types.mts'],consumer)
  console.log('Packed NodeNext declarations: passed')
  const bun=process.env.BUN??'bun'
  try {
    await run(bun,['smoke.mjs'],consumer)
    console.log(`Packed Bun contract: passed; real-IBIS in-memory run: ${input.circuitJson.length?'passed with canned waveform':'skipped (set IBIS_MODEL_DIR)'}`)
  }
  catch(error){
    if(/ENOENT/.test(error.message))console.log('Packed Bun smoke: skipped (set BUN to the executable)')
    else throw error
  }
} finally {await rm(temporary,{recursive:true,force:true})}
