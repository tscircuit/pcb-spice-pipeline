import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const source=resolve(process.argv[2]??root)
const temporary=mkdtempSync(join(tmpdir(),'pcb-packed-tsx-'))
const output=process.argv[3]?resolve(process.argv[3]):join(temporary,'result')
const consumer=join(temporary,'consumer')
mkdirSync(output,{recursive:true});mkdirSync(consumer)
const report={node:process.version,cases:[],versions:{tscircuit:'0.0.3053',react:'19.2.4'}}
const hash=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex')
const sanitize=text=>text.replaceAll(temporary,'<temporary>').replaceAll(source,'<package-build>')
function run(name,executable,args,cwd,timeout) {
  const start=performance.now()
  const child=spawnSync(executable,args,{cwd,encoding:'utf8',timeout,maxBuffer:8*1024*1024})
  writeFileSync(join(output,`${name}.log`),sanitize(`${child.stdout??''}${child.stderr??''}`))
  report.cases.push({name,exitCode:child.status,signal:child.signal,
    error:child.error?sanitize(child.error.message):undefined,elapsedSeconds:(performance.now()-start)/1000})
  console.log(JSON.stringify(report.cases.at(-1)))
  assert.equal(child.status,0,`${name} failed:\n${sanitize(`${child.stdout??''}${child.stderr??''}`)}`)
  return child.stdout
}
try {
  const packed=JSON.parse(run('pack','npm',['pack','--ignore-scripts','--json','--pack-destination',output],source,60000))[0]
  assert.ok(packed.files.some(file=>file.path==='dist/tsx.js'),'Build the package before running this test')
  assert.ok(packed.files.every(file=>file.path.startsWith('dist/')||['package.json','README.md','LICENSE'].includes(file.path)))
  const tarball=join(output,packed.filename)
  report.tarballSha256=hash(tarball)
  writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'packed-tsx-consumer',private:true,type:'module',
    dependencies:{...report.versions,'@tscircuit/pcb-spice-pipeline':`file:${tarball}`}},null,2))
  run('install','npm',['install','--ignore-scripts','--no-audit','--no-fund'],consumer,180000)
  copyFileSync(join(consumer,'package-lock.json'),join(output,'package-lock.json'))
  const installed=join(consumer,'node_modules/@tscircuit/pcb-spice-pipeline')
  assert.ok(!existsSync(join(installed,'src')))
  report.installedHashes={}
  for(const name of ['index.js','tsx.js','tsx-render.js']) {
    const actual=hash(join(installed,'dist',name))
    assert.equal(actual,hash(join(source,'dist',name)))
    report.installedHashes[name]=actual
  }
  report.consumerVersions={}
  for(const name of ['tscircuit','@tscircuit/core','circuit-json'])
    report.consumerVersions[name]=JSON.parse(readFileSync(join(consumer,'node_modules',name,'package.json'),'utf8')).version
  copyFileSync(join(root,'tests/fixtures/packed-tsx-consumer.mjs'),join(consumer,'packed-tsx-consumer.mjs'))
  run('imported-board',process.execPath,['--max-old-space-size=1536','--test','--test-reporter=spec',
    '--test-timeout=60000','packed-tsx-consumer.mjs'],consumer,90000)
  report.passed=true
} catch(error) {
  report.passed=false;report.error=sanitize(String(error));process.exitCode=1
} finally {
  writeFileSync(join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
  rmSync(temporary,{recursive:true,force:true})
}
