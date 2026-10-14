import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, dirname, join, extname } from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { hostname, platform, arch } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { convertIbisComponentToSpice,seconds } from '@tscircuit/ibis-to-spice'
import { geometryFromCircuitJson, fastHenryDeck, fasterCapDeck } from './geometry.mjs'
import { fail, parseFastHenry, parseFasterCap, validateMatrix, loopImpedance, referenceCapacitance, multiply, transpose, sum } from './matrices.mjs'
import { simulationSpice, channelSpice } from './spice.mjs'
import { waveformRows, measureWaveform, foldEye } from './metrics.mjs'
import { useNativeIbis } from './native-ibis.mjs'
import { eyeSimulation, resolveEyeDiagram } from './eyediagram.mjs'
const exec=promisify(execFile),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n')
const renderedBoardSummary=circuitJson=>{
  const count=type=>circuitJson.filter(element=>element.type===type).length,errorTypeCounts={}
  for(const element of circuitJson) if(element.type.endsWith('_error')) errorTypeCounts[element.type]=(errorTypeCounts[element.type]??0)+1
  return {sourceComponents:count('source_component'),sourcePorts:count('source_port'),sourceTraces:count('source_trace'),pcbTraces:count('pcb_trace'),smtPads:count('pcb_smtpad'),platedHoles:count('pcb_plated_hole'),vias:count('pcb_via'),boards:circuitJson.filter(element=>element.type==='pcb_board').map(({width,height,num_layers,center})=>({widthMm:width,heightMm:height,layers:num_layers,centerMm:center})),errorTypeCounts,scope:'Records the whole rendered board; successful selected-channel simulation does not resolve unrelated board diagnostics'}
}
async function command(executable,args,cwd,label) {
  const start=Date.now();let result
  try {const r=await exec(executable,args,{cwd,timeout:300000,maxBuffer:64*1024*1024,env:{...process.env,OMP_NUM_THREADS:'1'}});result={exitCode:0,stdout:r.stdout,stderr:r.stderr}}
  catch(e) {result={exitCode:e.code??null,signal:e.signal??null,killed:e.killed??false,stdout:e.stdout??'',stderr:e.stderr??e.message}}
  await writeFile(join(cwd,`${label}.stdout.log`),result.stdout);await writeFile(join(cwd,`${label}.stderr.log`),result.stderr)
  const record={executable,args,cwd,exitCode:result.exitCode,signal:result.signal??null,elapsedMs:Date.now()-start,environment:{OMP_NUM_THREADS:'1'}}
  await json(join(cwd,`${label}.command.json`),record)
  if(result.exitCode!==0) fail('native_solver',`${label} exited ${result.exitCode}; see ${cwd}/${label}.stderr.log`)
  return {...result,record}
}
async function vendorSource(lock,cache) {
  await mkdir(cache,{recursive:true});const ibs=join(cache,`${lock.sha256}.ibs`),zip=join(cache,`${lock.archiveSha256}.zip`)
  let bytes,archive
  try {archive=await readFile(zip)} catch {const response=await fetch(lock.url);if(!response.ok) fail('vendor_download',`${lock.vendor}: HTTP ${response.status}`);archive=Buffer.from(await response.arrayBuffer());if(sha256(archive)!==lock.archiveSha256) fail('vendor_hash',`${lock.vendor}: archive changed`);await writeFile(zip,archive)}
  if(sha256(archive)!==lock.archiveSha256) fail('vendor_hash',`${lock.vendor}: cached archive corrupt`)
  bytes=unzipSync(archive)[lock.archivePath]
  if(!bytes||sha256(bytes)!==lock.sha256) fail('vendor_hash',`${lock.vendor}: original IBIS bytes do not match lock`)
  await writeFile(ibs,bytes)
  return {bytes:Buffer.from(bytes),text:Buffer.from(bytes).toString('utf8'),archive,lock}
}
async function hashes(root,relative='',excludedRootNames=[]) {
  const out={}
  for(const name of (await readdir(join(root,relative))).sort()) {
    if((!relative&&excludedRootNames.includes(name))||name==='__pycache__'||name==='node_modules') continue
    const p=join(relative,name),s=await stat(join(root,p))
    if(s.isDirectory()) Object.assign(out,await hashes(root,p,excludedRootNames))
    else if(p!=='receipt.json') out[p]=sha256(await readFile(join(root,p)))
  }
  return out
}
export async function loadEntry(path) {
  const absolute=resolve(path),baseDir=dirname(absolute)
  if(/\.(tsx|ts|mjs|js)$/.test(path)) {
    const mod=await import(pathToFileURL(absolute))
    let cj=mod.circuitJson,eyeDiagrams=[]
    if(!cj) {
      const {Circuit}=await import('@tscircuit/core'),c=new Circuit()
      if(!mod.default) fail('tsx_entry','Export default TSX board or circuitJson, plus modeling')
      c.add(typeof mod.default==='function'?mod.default():mod.default);await c.renderUntilSettled();cj=c.getCircuitJson()
      eyeDiagrams=c.selectAll('eyediagram').map(eye=>eye.getEyeDiagramDescriptor())
    }
    if(!mod.modeling) fail('tsx_entry','Export modeling with explicit physical inputs')
    let originalCircuitBytes,circuitPath,originalSourceCircuitJsonSha256
    if(mod.modeling.circuit) {
      circuitPath=resolve(baseDir,mod.modeling.circuit);originalCircuitBytes=await readFile(circuitPath)
      const originalJson=circuitPath.endsWith('.gz')?gunzipSync(originalCircuitBytes):originalCircuitBytes
      originalSourceCircuitJsonSha256=sha256(originalJson)
      if(mod.modeling.fixtureProvenance?.originalJsonSha256&&originalSourceCircuitJsonSha256!==mod.modeling.fixtureProvenance.originalJsonSha256)
        fail('geometry_hash','Original source Circuit JSON differs from pinned provenance')
    }
    return {circuitJson:cj,modeling:mod.modeling,eyeDiagrams,baseDir,entryBytes:await readFile(absolute),entryPath:absolute,originalCircuitBytes,circuitPath,originalSourceCircuitJsonSha256}
  }
  const entryBytes=await readFile(absolute),modeling=JSON.parse(entryBytes)
  if(!modeling.circuit) fail('circuit_json','JSON entry needs circuit path to array or gzip array')
  const circuitPath=resolve(baseDir,modeling.circuit),original=await readFile(circuitPath),bytes=circuitPath.endsWith('.gz')?gunzipSync(original):original
  const circuitJson=JSON.parse(bytes)
  if(modeling.fixtureProvenance?.originalJsonSha256&&sha256(bytes)!==modeling.fixtureProvenance.originalJsonSha256) fail('geometry_hash','Original source Circuit JSON differs from pinned provenance')
  return {circuitJson,modeling,baseDir,entryBytes,entryPath:absolute,circuitBytes:bytes,originalCircuitBytes:original,circuitPath}
}
export async function runPipeline({circuitJson,modeling,eyeDiagrams=[],outputDir,tools,baseDir=repo,entryBytes,entryPath,circuitBytes,originalCircuitBytes,circuitPath,originalSourceCircuitJsonSha256,onProgress=()=>{}}) {
  const out=resolve(outputDir)
  try {await stat(out);fail('output_exists',`Use a fresh output directory for regeneration: ${out}`)} catch(e) {if(e.code!=='ENOENT') throw e}
  modeling=eyeSimulation(modeling,eyeDiagrams)
  const geometry=geometryFromCircuitJson(circuitJson,modeling),eye=resolveEyeDiagram(geometry,modeling,eyeDiagrams)
  const handoff=JSON.parse(await readFile(join(repo,'vendor/ibis-to-spice-handoff.json')))
  if(sha256(await readFile(join(repo,'vendor/ibis-to-spice-0.0.1.tgz')))!==handoff.packageSha256) fail('converter_hash','Installed package source tarball changed from immutable handoff')
  for(const lane of modeling.lanes) {
    const output=modeling.driver?.pins?.[lane.driverPort??lane.port],input=modeling.receiver?.pins?.[lane.receiverPort??lane.port]
    if(output?.mode!=='output'||input?.mode!=='input'||output.stimulus?.type!=='clock') fail('ibis_mapping',`${lane.port}: explicit output clock driver and input receiver required`)
    if(Math.abs(seconds(output.stimulus.period)/(2*modeling.simulation.uiSeconds)-1)>1e-10) fail('clock_ui',`${lane.port}: UI must equal driver clock period/2`)
    if(seconds(output.stimulus.duration)<modeling.simulation.durationSeconds) fail('clock_duration',`${lane.port}: driver stimulus ends before simulation`)
  }
  await mkdir(join(out,'inputs'),{recursive:true})
  await json(join(out,'inputs/modeling.json'),modeling)
  await writeFile(join(out,'inputs/circuit.json'),circuitBytes??JSON.stringify(circuitJson,null,2)+'\n')
  if(originalCircuitBytes) await writeFile(join(out,'inputs/original.circuit'+(circuitPath.endsWith('.gz')?'.json.gz':'.json')),originalCircuitBytes)
  if(entryBytes) await writeFile(join(out,'inputs/entry'+extname(entryPath)),entryBytes)
  await json(join(out,'geometry.json'),geometry)
  await json(join(out,'eyediagram.json'),eye)
  const renderedBoard=renderedBoardSummary(circuitJson)
  await json(join(out,'rendered-board.json'),renderedBoard)
  if(!tools) tools=JSON.parse(await readFile(process.env.PCB_SPICE_TOOLS??join(repo,'.cache/tools/tools.json')))
  const toolEvidence={}
  for(const name of ['fasthenry','fastercap','ngspice']) {
    const executable=resolve(tools[name]);toolEvidence[name]={executable,sha256:sha256(await readFile(executable)),host:hostname(),platform:platform(),architecture:arch()}
  }
  const buildDir=dirname(tools.configPath??process.env.PCB_SPICE_TOOLS??join(repo,'.cache/tools/tools.json'))
  try {toolEvidence.setup=JSON.parse(await readFile(join(buildDir,'build-receipt.json')));await json(join(out,'tool-build-receipt.json'),toolEvidence.setup)} catch(e) {if(e.code!=='ENOENT') throw e}
  await json(join(out,'tool-evidence.json'),toolEvidence)
  const extracted=[]
  for(const cell of geometry.cells) {
    onProgress(`Extract stage ${cell.stage} (${cell.profile}) with actual native FastHenry and FasterCap`)
    const dir=join(out,`stage-${cell.stage}`);await mkdir(dir)
    await writeFile(join(dir,'channel.inp'),fastHenryDeck(cell,modeling.extraction))
    const fc=fasterCapDeck(cell,modeling.extraction)
    for(const [file,body] of Object.entries(fc)) await writeFile(join(dir,file),body)
    await command(tools.fasthenry,['channel.inp'],dir,'fasthenry')
    const ztext=await readFile(join(dir,'Zc.mat'),'utf8')
    for(let i=0;i<3;i++) if(!new RegExp(`Row ${i+1}:\\s+N${i}a\\s+to\\s+N${i}b`,'i').test(ztext)) fail('matrix_order','FastHenry external port ordering is not sig0,sig1,return')
    const spectrum=parseFastHenry(ztext)
    const lowest=spectrum.reduce((a,b)=>a.frequencyHz<b.frequencyHz?a:b),coarse=spectrum.find(s=>Math.abs(s.frequencyHz/modeling.extraction.modelHz-1)<1e-8)
    if(!coarse) fail('model_frequency','modelHz must be one executed FastHenry sample frequency')
    const refinement=join(dir,'refinement');await mkdir(refinement)
    await writeFile(join(refinement,'channel.inp'),fastHenryDeck(cell,{...modeling.extraction,minimumHz:modeling.extraction.modelHz,maximumHz:modeling.extraction.modelHz,filaments:modeling.extraction.refinementFilaments}))
    await command(tools.fasthenry,['channel.inp'],refinement,'fasthenry')
    const selected=parseFastHenry(await readFile(join(refinement,'Zc.mat'),'utf8'))[0]
    const convergence={coarseFilaments:modeling.extraction.filaments,refinedFilaments:modeling.extraction.refinementFilaments,frequencyHz:selected.frequencyHz,definition:'max(abs(refined-coarse))/max(abs(refined)) for full referenced matrix',tolerance:modeling.extraction.convergenceTolerance}
    for(const kind of ['R','L']) {
      const a=loopImpedance(coarse[kind]),b=loopImpedance(selected[kind])
      convergence[kind]=Math.max(...b.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-a[i][j]))))/Math.max(...b.flat().map(Math.abs))
      if(convergence[kind]>convergence.tolerance) fail('mesh_convergence',`Stage ${cell.stage} ${kind} filament refinement residual ${convergence[kind]} > ${convergence.tolerance}; increase both mesh counts explicitly`)
    }
    const analytic=cell.conductors.map(c=>c.lengthM/(cell.conductivitySm*c.widthM*c.thicknessM))
    const errors=analytic.map((v,i)=>Math.abs(lowest.R[i][i]/v-1))
    if(errors.some(e=>e>modeling.extraction.dcResistanceTolerance)) fail('analytic_resistance',`DC geometry check failed: errors ${errors.join(',')}`)
    const analyticLoop=loopImpedance(analytic.map((v,i)=>analytic.map((_,j)=>i===j?v:0))),dcLoop=loopImpedance(lowest.R)
    const dcLoopResidual=Math.max(...dcLoop.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-analyticLoop[i][j]))))/Math.max(...analyticLoop.flat())
    if(dcLoopResidual>modeling.extraction.dcResistanceTolerance) fail('analytic_return',`Shared-return DC resistance mismatch ${dcLoopResidual}`)
    const R=validateMatrix(loopImpedance(selected.R),'R loop',modeling.extraction.reciprocityTolerance),L=validateMatrix(loopImpedance(selected.L),'L loop',modeling.extraction.reciprocityTolerance)
    validateMatrix(selected.R,'R primitive',modeling.extraction.reciprocityTolerance);validateMatrix(selected.L,'L primitive',modeling.extraction.reciprocityTolerance)
    const capRun=await command(tools.fastercap,['channel.lst','-b',`-a${modeling.extraction.capTolerance}`,'-e'],dir,'fastercap')
    const cap=parseFasterCap(capRun.stdout)
    const capDiff=[...capRun.stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)
    const capConvergence=capDiff?Number(capDiff[1]):null
    if(capConvergence===null||capConvergence>modeling.extraction.capTolerance) fail('cap_convergence','FasterCap did not report converged automatic refinement within requested tolerance')
    if(!cap.names.every((n,i)=>n.endsWith(`_${cell.conductors[i].name}`))) fail('matrix_order',`FasterCap C conductor ordering changed: ${cap.names}`)
    const primitiveC=validateMatrix(cap.matrix,'C primitive',modeling.extraction.reciprocityTolerance),C=referenceCapacitance(primitiveC.matrix)
    if(primitiveC.matrix.some((r,i)=>sum(r)<=0||r.some((v,j)=>i!==j&&v>0))) fail('capacitance_sign','Primitive Maxwell matrix needs nonpositive off-diagonals and positive capacitance to infinity')
    const cr=primitiveC.matrix.map(sum),v=[1.2,-.7],offset=-(cr[0]*v[0]+cr[1]*v[1])/C.denominator,full=[[v[0]+offset],[v[1]+offset],[offset]],q=multiply(primitiveC.matrix,full)
    const energy=multiply(transpose(full),q)[0][0],reducedEnergy=multiply(multiply([v],C.matrix),transpose([v]))[0][0]
    const energyResidual=Math.abs(energy-reducedEnergy)/Math.abs(energy),neutralityResidual=Math.abs(sum(q.flat()))/Math.max(...q.flat().map(Math.abs))
    if(energyResidual>1e-10||neutralityResidual>1e-10) fail('reference_energy','Neutral finite-return charge/energy reconstruction failed')
    const result={stage:cell.stage,profile:cell.profile,R:R.matrix,L:L.matrix,C:C.matrix,units:{R:'ohm',L:'H',C:'F'},frequencyHz:selected.frequencyHz,primitiveOrder:['sig0','sig1','return'],primitiveImpedance:spectrum,modelPrimitiveImpedance:selected,primitiveCapacitance:cap.matrix,checks:{R,L,C,primitiveC,convergence,capConvergence,analyticResistanceOhm:analytic,analyticResistanceRelativeErrors:errors,analyticFrequencyHz:lowest.frequencyHz,analyticLoopResistanceOhm:analyticLoop,dcLoopResidual,energyResidual,neutralityResidual},conversions:{impedance:'R=Re(Z), L=Im(Z)/(2*pi*f); A=[[1,0],[0,1],[-1,-1]]; loop=A^T primitive A',capacitance:C.convention,neutralityDenominatorF:C.denominator}}
    await json(join(dir,'extraction.json'),result);extracted.push(result)
  }
  onProgress('Load hash-locked original vendor models and call reusable converter')
  if(!Array.isArray(modeling.vendors)||modeling.vendors.length!==2) fail('ibis_mapping','Explicit driver and receiver vendor download locks required')
  const sources=[]
  for(const lock of modeling.vendors) {const s=await vendorSource(lock,join(repo,'.cache/vendors'));sources.push(s);await writeFile(join(out,'inputs',lock.file),s.bytes);await writeFile(join(out,'inputs',`${lock.vendor.replaceAll(' ','-')}.zip`),s.archive)}
  for(const [name,config] of [['driver',modeling.driver],['receiver',modeling.receiver]]) {
    if(!config) fail('ibis_mapping',`${name} configuration required`)
    for(const lane of modeling.lanes) {const port=lane[name==='driver'?'driverPort':'receiverPort']??lane.port;if(!config.pins[port]) fail('ibis_mapping',`${name} lacks ${port}`)}
  }
  let driver=convertIbisComponentToSpice(sources[0].text,modeling.driver),receiver=convertIbisComponentToSpice(sources[1].text,modeling.receiver)
  let nativeEvidence=null
  if(modeling.requireNativeIbis) {
    const nativePackages=JSON.parse(await readFile(join(repo,'vendor/native-ibis-packages-handoff.json')))
    for(const [name,file] of [['core','tscircuit-core-ibis-experimental.tgz'],['props','tscircuit-props-ibis-experimental.tgz']]) if(sha256(await readFile(join(repo,'vendor',file)))!==nativePackages.packages[name].sha256) fail('native_package_hash',`${name} package differs from immutable handoff`)
    const native=useNativeIbis(circuitJson,geometry,modeling,{driver,receiver})
    driver=native.driver;receiver=native.receiver;nativeEvidence={...native.evidence,packages:nativePackages}
    await json(join(out,'native-ibis-assembly.json'),nativeEvidence)
  }
  await json(join(out,'ibis-conversion.json'),{driver:{spicePinMapping:driver.spicePinMapping,warnings:driver.warnings},receiver:{spicePinMapping:receiver.spicePinMapping,warnings:receiver.warnings},vendors:modeling.vendors})
  await writeFile(join(out,'driver.lib'),driver.source);await writeFile(join(out,'receiver.lib'),receiver.source);await writeFile(join(out,'channel.cir'),channelSpice(extracted,modeling.sections));await writeFile(join(out,'simulation.cir'),simulationSpice(modeling,extracted,driver,receiver))
  onProgress('Run actual native ngspice transient and measure generated samples')
  await command(tools.ngspice,['-b','simulation.cir'],out,'ngspice')
  const rows=waveformRows(await readFile(join(out,'waveform.dat'),'utf8')),metrics=measureWaveform(rows,modeling.simulation,eye),folded=foldEye(rows,metrics,eye)
  await writeFile(join(out,'waveform.csv'),'time_s,driver_p_v,driver_n_v,receiver_p_v,receiver_n_v,receiver_diff_v,driver_diff_v\n'+rows.map(r=>r.join(',')).join('\n')+'\n')
  await json(join(out,'metrics.json'),metrics)
  await writeFile(join(out,'eye-data.csv'),'window,folded_time_s,differential_v\n'+folded.samples.map(r=>r.join(',')).join('\n')+'\n')
  await json(join(out,'eye-data.json'),{name:eye.name,endpoint:eye.endpoint,polarity:eye.polarity,windows:folded.windows,pointsPerWindow:folded.pointsPerWindow,interpolation:'linear interpolation of executed adaptive ngspice samples',source:'waveform.csv',sourceSha256:sha256(await readFile(join(out,'waveform.csv')))})
  onProgress('Plot measured transient and deterministic clock eye')
  await command(process.env.PCB_SPICE_PYTHON??join(repo,'.venv/bin/python3'),[join(repo,'scripts/plot.py'),out],out,'plot')
  let gitCommit=null,sourceTreeDirty=null
  try {if(resolve((await exec('git',['rev-parse','--show-toplevel'],{cwd:repo})).stdout.trim())===repo) {gitCommit=(await exec('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim();sourceTreeDirty=Boolean((await exec('git',['status','--porcelain'],{cwd:repo})).stdout.trim())}} catch {}
  const sourceRoots=['.gitignore','.github','LICENSE','README.md','examples','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','requirements.lock.txt','scripts','src','tests','toolchain-lock.json','tsconfig.json','vendor']
  const sourceFiles=await hashes(repo,'',(await readdir(repo)).filter(name=>!sourceRoots.includes(name)))
  const receipt={schemaVersion:2,status:'executed',execution:{host:hostname(),platform:platform(),architecture:arch(),nativeLocalMac:platform()==='darwin',timestampUtc:new Date().toISOString(),node:process.version,gitCommit,sourceTreeDirty,solverResultCache:false},sourceFiles,entryPath:entryPath??null,description:modeling.description,sourceCircuitJsonSha256:sha256(circuitBytes??JSON.stringify(circuitJson,null,2)+'\n'),originalSourceCircuitJsonSha256:originalSourceCircuitJsonSha256??(originalCircuitBytes?sha256(circuitPath.endsWith('.gz')?gunzipSync(originalCircuitBytes):originalCircuitBytes):null),originalSourceArchiveSha256:originalCircuitBytes?sha256(originalCircuitBytes):null,fixtureProvenance:modeling.fixtureProvenance??null,sourceProvenance:modeling.sourceProvenance??null,preSolvedAssessment:modeling.sourceProvenance?.preSolvedAssessment??null,renderedBoard,converter:{commit:handoff.commit,packageSha256:handoff.packageSha256},nativeIbis:nativeEvidence,eyeDiagram:eye,toolEvidence,matrices:extracted.map(e=>({stage:e.stage,R:e.R,L:e.L,C:e.C,units:e.units})),metrics,limitations:[...geometry.approximations,...driver.warnings,...receiver.warnings,'TI Model_655/847 and Winbond ODT_60 are explicit demonstration IO settings, not known board firmware','This reduced channel is not full-board EM extraction or independent silicon validation'],files:await hashes(out)}
  await json(join(out,'receipt.json'),receipt)
  return receipt
}
