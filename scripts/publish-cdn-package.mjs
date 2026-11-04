import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'pcb-cdn-release-'))
const git=(args,options={})=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024,...options})
const refExists=ref=>{
  const result=spawnSync('git',['ls-remote','--exit-code','origin',ref],{cwd:root,encoding:'utf8'})
  if(result.status===2) return false
  if(result.status!==0) throw Error(result.stderr||result.error?.message||'Cannot read release references')
  return true
}
const fetchRef=ref=>{
  git(['fetch','--quiet','origin',ref])
  return git(['rev-parse','FETCH_HEAD']).toString().trim()
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
try {
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  assert.match(manifest.version,/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/)
  const repository=new URL(manifest.repository.url)
  assert.equal(repository.hostname,'github.com')
  const project=repository.pathname.replace(/^\//,'').replace(/\.git$/,'')
  const sourceCommit=git(['rev-parse','HEAD']).toString().trim()
  assert.equal(git(['status','--porcelain']).toString().trim(),'','Commit source changes before publishing')
  const packed=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',temporary],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}))[0]
  assert.equal(packed.name,manifest.name)
  assert.equal(packed.version,manifest.version)
  const archive=await readFile(join(temporary,packed.filename))
  assert.ok(archive.length<=20*1024*1024,'Package archive exceeds jsDelivr GitHub file limit')
  const metadata={name:manifest.name,version:manifest.version,sourceCommit,sha256:hash(archive)}
  const branch='refs/heads/package-releases',tag=`refs/tags/cdn-v${manifest.version}`
  const path='packages/pcb-spice-pipeline.tgz'
  const url=`https://cdn.jsdelivr.net/gh/${project}@cdn-v${manifest.version}/${path}`
  if(refExists(tag)) {
    const commit=fetchRef(tag)
    const existing=JSON.parse(git(['show',`${commit}:release.json`]).toString())
    assert.deepEqual(existing,metadata,'Release already exists with different package bytes or source; publish a new version')
    assert.equal(hash(git(['show',`${commit}:${path}`])),metadata.sha256)
    console.log(`Already published: ${url}`)
  } else {
    const parent=refExists(branch)?fetchRef(branch):undefined
    // Use an isolated index so publishing never switches or edits the source checkout.
    const env={...process.env,GIT_INDEX_FILE:join(temporary,'index')}
    git(['read-tree','--empty'],{env})
    for(const [name,bytes] of [[path,archive],['release.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n')]]) {
      const blob=git(['hash-object','-w','--stdin'],{input:bytes}).toString().trim()
      git(['update-index','--add','--cacheinfo',`100644,${blob},${name}`],{env})
    }
    const tree=git(['write-tree'],{env}).toString().trim()
    const commit=git(['commit-tree',tree,...(parent?['-p',parent]:[]),'-m',`Publish ${manifest.name}@${manifest.version}`]).toString().trim()
    // Both refs must succeed together. Existing release tags are never overwritten.
    git(['push','--atomic','origin',`${commit}:${branch}`,`${commit}:${tag}`],{stdio:['ignore','pipe','inherit']})
    console.log(`Published: ${url}`)
  }
} finally {await rm(temporary,{recursive:true,force:true})}
