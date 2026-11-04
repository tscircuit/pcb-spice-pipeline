import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const script=fileURLToPath(new URL('../scripts/publish-cdn-package.mjs',import.meta.url))
test('CDN release archives are installable, retryable and immutable across versions',async t=>{
  const temporary=await mkdtemp(join(tmpdir(),'pcb-cdn-test-'))
  t.after(()=>rm(temporary,{recursive:true,force:true}))
  const source=join(temporary,'source'),remote=join(temporary,'origin.git')
  await mkdir(source)
  const git=(args,cwd=source)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  git(['init','--bare',remote],temporary)
  git(['init','-b','main'])
  git(['config','user.name','Package test'])
  git(['config','user.email','package-test@example.com'])
  git(['remote','add','origin',remote])
  const manifest={name:'@tscircuit/pcb-spice-pipeline',version:'0.1.1',repository:{type:'git',url:'https://github.com/tscircuit/pcb-spice-pipeline.git'},files:['index.js']}
  await writeFile(join(source,'package.json'),JSON.stringify(manifest))
  await writeFile(join(source,'index.js'),'module.exports = 1\n')
  git(['add','.']);git(['commit','-m','Initial package']);git(['push','origin','main'])
  const sourceCommit=git(['rev-parse','HEAD'])
  const env={...process.env,npm_config_offline:'true',npm_config_cache:join(temporary,'npm-cache')}
  const publish=()=>spawnSync(process.execPath,[script],{cwd:source,encoding:'utf8',env})
  const first=publish()
  assert.equal(first.status,0,first.stderr)
  assert.match(first.stdout,/Published: https:\/\/cdn.jsdelivr.net\/gh\/tscircuit\/pcb-spice-pipeline@cdn-v0.1.1\/packages\/pcb-spice-pipeline.tgz/)
  const tag='refs/tags/cdn-v0.1.1',commit=git(['rev-parse',tag],remote)
  const metadata=JSON.parse(git(['show',`${tag}:release.json`],remote))
  const archive=execFileSync('git',['show',`${tag}:packages/pcb-spice-pipeline.tgz`],{cwd:remote})
  assert.equal(metadata.version,'0.1.1');assert.equal(metadata.sourceCommit,sourceCommit)
  assert.equal(createHash('sha256').update(archive).digest('hex'),metadata.sha256)
  const consumer=join(temporary,'consumer');await mkdir(consumer)
  const tarball=join(temporary,'package.tgz');await writeFile(tarball,archive)
  execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',tarball],{cwd:consumer,stdio:'pipe',env})
  assert.equal(execFileSync(process.execPath,['-p',"require('@tscircuit/pcb-spice-pipeline')"],{cwd:consumer,encoding:'utf8'}).trim(),'1')
  const retry=publish()
  assert.equal(retry.status,0,retry.stderr);assert.match(retry.stdout,/Already published:/)
  assert.equal(git(['rev-parse',tag],remote),commit)
  await writeFile(join(source,'index.js'),'module.exports = 2\n')
  git(['add','.']);git(['commit','-m','Changed package'])
  const overwrite=publish()
  assert.notEqual(overwrite.status,0)
  assert.match(overwrite.stderr,/Release already exists with different package bytes or source/)
  assert.equal(git(['rev-parse',tag],remote),commit)
  manifest.version='0.1.2';await writeFile(join(source,'package.json'),JSON.stringify(manifest))
  git(['add','.']);git(['commit','-m','Next package version'])
  const next=publish();assert.equal(next.status,0,next.stderr)
  assert.equal(git(['rev-parse','package-releases^'],remote),commit)
  assert.equal(JSON.parse(git(['show','cdn-v0.1.2:release.json'],remote)).version,'0.1.2')
  assert.deepEqual(execFileSync('git',['show',`${tag}:packages/pcb-spice-pipeline.tgz`],{cwd:remote}),archive)
  assert.equal(git(['branch','--show-current']),'main')
  assert.equal(git(['status','--porcelain']),'')
})
