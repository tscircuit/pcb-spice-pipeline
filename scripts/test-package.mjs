import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm,access,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {inMemoryInput} from '../tests/fixtures/in-memory.mjs'

const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url))
const temporary=await mkdtemp(join(tmpdir(),'pcb-package-'))
const run=async(executable,args,cwd)=>{
  try{return await exec(executable,args,{cwd,timeout:180000,maxBuffer:8*1024*1024})}
  catch(error){throw Error(`${executable} ${args.join(' ')}\n${error.stdout??''}\n${error.stderr??error.message}`)}
}
try {
  const packed=JSON.parse((await run('npm',['pack','--json','--pack-destination',temporary],root)).stdout)[0]
  assert.ok(packed.files.every(file=>file.path.startsWith('dist/')||['README.md','LICENSE','package.json'].includes(file.path)))
  assert.ok(!packed.files.some(file=>/dist\/(?:setup|runtime|cli|pipeline)\./.test(file.path)))
  const consumer=join(temporary,'consumer');await mkdir(consumer)
  await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
  await run('npm',['install','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund',join(temporary,packed.filename)],consumer)
  const installed=join(consumer,'node_modules/@tscircuit/pcb-spice-pipeline')
  await assert.rejects(access(join(installed,'src')),{code:'ENOENT'})
  await assert.rejects(access(join(consumer,'node_modules/react')),{code:'ENOENT'})
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'))
  assert.equal(manifest.name,'@tscircuit/pcb-spice-pipeline')
  assert.equal(manifest.main,'./dist/index.js');assert.equal(manifest.types,'./dist/index.d.ts')
  assert.equal(manifest.scripts.prepare,undefined)
  assert.ok(Object.values(manifest.peerDependenciesMeta).every(peer=>peer.optional))
  const input=inMemoryInput()
  input.ibisSources=Object.fromEntries(Object.entries(input.ibisSources).map(([path,bytes])=>[path,bytes.toString('utf8')]))
  await writeFile(join(consumer,'input.json'),JSON.stringify(input))
  await copyFile(join(root,'tests/fixtures/solver.mjs'),join(consumer,'solver.mjs'))
  const smoke=`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runPipeline,generateReport} from '@tscircuit/pcb-spice-pipeline';
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '@tscircuit/pcb-spice-pipeline/node';
import {fixtureSolver} from './solver.mjs';
const result=await runPipeline({...JSON.parse(readFileSync('input.json','utf8')),runSolver:fixtureSolver});
assert.equal(result.experiments.length,1);assert.ok(generateReport(result)['results.html']);
assert.equal(typeof createNativeSolver,'function');assert.equal(typeof loadIbisSources,'function');assert.equal(typeof writePipelineOutput,'function');`
  await writeFile(join(consumer,'smoke.mjs'),smoke)
  await run(process.execPath,['smoke.mjs'],consumer)
  console.log('Packed Node import + complete in-memory run: passed (no peers, source tree or install scripts)')
  const denied=(await readFile(join(root,'tests/denied-host.mjs'),'utf8'))
    .replace("'./fixtures/solver.mjs'","'./solver.mjs'").replace("'../dist/index.js'","'@tscircuit/pcb-spice-pipeline'")
  await writeFile(join(consumer,'denied-host.mjs'),denied.replace("readFileSync(0,'utf8')","readFileSync('input.json','utf8')"))
  await run(process.execPath,['denied-host.mjs'],consumer)
  console.log('Packed cold import + run with host actions denied: passed')
  await writeFile(join(consumer,'types.mts'),`import {runPipeline,generateReport,type PipelineOptions,type SolverRequest} from '@tscircuit/pcb-spice-pipeline';
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '@tscircuit/pcb-spice-pipeline/node';
const execute=async(options:PipelineOptions)=>{const result=await runPipeline(options);const html:string=generateReport(result)['results.html'];await writePipelineOutput({result,outputDir:html})};
const solver=createNativeSolver();const load=loadIbisSources;const request:SolverRequest={solver:'ngspice',files:{},args:[],outputFiles:[]};void execute;void solver;void load;void request;`)
  await run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','false','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','types.mts'],consumer)
  console.log('Packed NodeNext declarations: passed')
  const bun=process.env.BUN??'bun'
  try {await run(bun,['smoke.mjs'],consumer);console.log('Packed Bun import + complete in-memory run: passed')}
  catch(error){if(/ENOENT/.test(error.message))console.log('Packed Bun smoke: skipped (set BUN to the executable)');else throw error}
} finally {await rm(temporary,{recursive:true,force:true})}
