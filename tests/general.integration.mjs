import {channelStage} from './support/channel'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {runPipeline,generateReport} from '../dist/index.js'
import {createNativeSolver,loadIbisSources,writePipelineOutput} from '../dist/node.js'
import {channelSpice} from '../src/extraction/index.js'
import {inMemoryInput} from './fixtures/in-memory.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const output=join(root,'runs','native-library-regression')
const solver=createNativeSolver({tools:{fasthenry:process.env.PCB_SPICE_FASTHENRY??'fasthenry',
  fastercap:process.env.PCB_SPICE_FASTERCAP??'FasterCap',ngspice:process.env.PCB_SPICE_NGSPICE??'ngspice'}})

test('native three-signal channel obeys the complete R + j*w*L impedance matrix and Maxwell C',async()=>{
  const dir=join(output,'three-signal-matrix')
  await mkdir(dir,{recursive:true})
  const R=[[2,.3,.4],[.3,3,.5],[.4,.5,4]]
  const L=[[4e-9,1e-9,.8e-9],[1e-9,5e-9,1.2e-9],[.8e-9,1.2e-9,6e-9]]
  const C=[[5e-12,-1e-12,-.5e-12],[-1e-12,6e-12,-.8e-12],[-.5e-12,-.8e-12,7e-12]]
  const currents=[.001,.002,.004]
  const voltage=[1,2,3]
  const frequency=1e8
  // Independent AC columns: grounded outputs reveal series Z; open outputs reveal shunt C.
  const deck=['Matrix regression',channelSpice([channelStage({R,L,C})],3)]
  for(let i=0;i<3;i++) deck.push(`IR${i} 0 in${i} AC ${currents[i]}`,`VC${i} c${i} 0 AC ${voltage[i]}`)
  deck.push('XR in0 in1 in2 0 0 0 0 CHANNEL','XC c0 c1 c2 open0 open1 open2 0 CHANNEL','.control','set wr_singlescale','set wr_vecnames',`ac lin 1 ${frequency} ${frequency}`,'wrdata result.dat v(in0) v(in1) v(in2) i(VC0) i(VC1) i(VC2)','quit','.endc','.end')
  await writeFile(join(dir,'matrix.cir'),deck.join('\n')+'\n')
  await writeFile(join(dir,'.spiceinit'),'quit\n')
  const solved=await solver({solver:'ngspice',args:['-n','-b','matrix.cir'],files:{'matrix.cir':deck.join('\n')+'\n','.spiceinit':'quit\n'},outputFiles:['result.dat']})
  const values=solved.files['result.dat'].trim().split(/\r?\n/)[1].trim().split(/\s+/).map(Number)
  const omega=2*Math.PI*frequency
  // Independently solve the complex pi-network: (Z^-1 + j*w*C/2)^-1 * I.
  const complex=(real,imag=0)=>[real,imag]
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1]]
  const mul=(a,b)=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]]
  const div=(a,b)=>mul(a,[b[0]/(b[0]**2+b[1]**2),-b[1]/(b[0]**2+b[1]**2)])
  const solve=(matrix,rhs)=>{
    const a=matrix.map((row,i)=>[...row.map(v=>[...v]),[...rhs[i]]])
    for(let i=0;i<3;i++) {
      const pivot=a[i][i]
      a[i]=a[i].map(v=>div(v,pivot))
      for(let j=0;j<3;j++) if(j!==i) {
        const factor=a[j][i]
        a[j]=a[j].map((v,k)=>add(v,mul(complex(-1),mul(factor,a[i][k]))))
      }
    }
    return a.map(row=>row[3])
  }
  const Z=R.map((row,i)=>row.map((v,j)=>complex(v,omega*L[i][j])))
  const admittance=Array.from({length:3},(_,j)=>solve(Z,Array.from({length:3},(_,i)=>complex(Number(i===j)))))
  const Y=C.map((row,i)=>row.map((v,j)=>add(admittance[j][i],complex(0,omega*v/2))))
  const expected=solve(Y,currents.map(v=>complex(v)))
  for(let i=0;i<3;i++) for(let part=0;part<2;part++) assert.ok(Math.abs(values[1+2*i+part]-expected[i][part])<1e-8,'full series impedance, including every mutual term')
  // Open-end voltages require a second complex network solve to include all shunt couplings.
  const openY=C.map((row,i)=>row.map((v,j)=>add(admittance[j][i],complex(0,omega*v/2))))
  const rhs=admittance[0].map((_,i)=>voltage.reduce((s,v,j)=>add(s,mul(admittance[j][i],complex(v))),complex(0)))
  const open=solve(openY,rhs)
  const supplyCurrent=voltage.map((v,i)=>voltage.reduce((s,w,j)=>add(s,add(mul(complex(0,omega*C[i][j]/2),complex(w)),mul(admittance[j][i],add(complex(w),mul(complex(-1),open[j]))))),complex(0)))
  for(let i=0;i<3;i++) for(let part=0;part<2;part++) assert.ok(Math.abs(values[7+2*i+part]+supplyCurrent[i][part])<1e-8,'all Maxwell shunts and mutual capacitors survive')
})

test('full in-memory pipeline executes real extraction, refinement and ngspice before explicit output',async()=>{
  const input=inMemoryInput()
  const calls=[]
  const result=await runPipeline({...input,runSolver:async request=>{
    calls.push(request.solver)
    return solver(request)
  }})
  assert.deepEqual(calls,['ngspice'])
  assert.equal(result.matrices.length,1)
  const matrix=result.matrices[0]
  assert.ok(matrix.mesh.at(-1).residual < .005)
  const run=result.experiments[0]
  assert.equal(run.solverInvocations,1)
  assert.ok(run.waveform.rows.length>100)
  assert.ok(run.eyes.every(eye=>eye.windows>3&&eye.samples.length===eye.windows*1200))
  for(const probe of run.probes) {
    const graph=result.simulationResultCircuitJson.find(record=>record.type==='simulation_transient_voltage_graph'&&record.simulation_voltage_probe_id===probe.simulationVoltageProbeId)
    assert.deepEqual(graph.timestamps_ms,run.waveform.rows.map(row=>row[0]*1000))
    assert.deepEqual(graph.voltage_levels,run.waveform.rows.map(row=>row[probe.column]))
  }
  assert.match(generateReport(result)['results.html'],/Simulation complete/)
  await writePipelineOutput({result,outputDir:join(output,'input-buffer-channel')})
})

// Vendor preparation is explicitly caller-owned. Enable this additional native
// regression only when the exact locally prepared assets are supplied.
test('actual vendor single-ended and differential boards preserve driven data and eye bindings',
  {skip:!process.env.PCB_SPICE_TEST_MODEL_DIR},async()=>{
  for(const name of ['single-ended','differential-data']) {
    const {circuitJson,modeling}=await import(`../examples/${name}/index.circuit.tsx`)
    const ibisSources=await loadIbisSources({circuitJson,baseDir:process.env.PCB_SPICE_TEST_MODEL_DIR})
    const result=await runPipeline({circuitJson,modeling,ibisSources,runSolver:solver})
    for(const run of result.experiments) {
      assert.ok(run.eyes.length>=2)
      for(const probe of run.probes) {
        const values=run.waveform.rows.map(row=>row[probe.column])
        assert.ok(Math.max(...values)-Math.min(...values)>.5)
      }
      assert.ok(run.eyes.every(eye=>eye.windows>3))
    }
    await writePipelineOutput({result,outputDir:join(output,name)})
  }
})

test('native Foster RL and general passive RC modes reproduce independently calculated complex multiport currents',async()=>{
  const R=[[2,.3,.4],[.3,3,.5],[.4,.5,4]]
  const L=[[4e-9,1e-9,.8e-9],[1e-9,5e-9,1.2e-9],[.8e-9,1.2e-9,6e-9]]
  const C=[[5e-12,-1e-12,-.5e-12],[-1e-12,6e-12,-.8e-12],[-.5e-12,-.8e-12,7e-12]]
  const S=[[.03,.01,0],[.01,.05,.01],[0,.01,.04]]
  const D=[[.4e-12,.08e-12,.03e-12],[.08e-12,.6e-12,.04e-12],[.03e-12,.04e-12,.5e-12]]
  const pole=2*Math.PI*1e7
  const omega=2*Math.PI*1e8
  const stage=channelStage({R,L,C})
  stage.skin={matrix:S,fit:{poles:[pole],weights:[1]}}
  stage.dielectric={matrix:D,fit:{poles:[pole],weights:[pole]}}
  const voltage=[1,2,3]
  const deck=['General passive modes',channelSpice([stage],3),...voltage.map((v,i)=>`V${i} in${i} 0 AC ${v}`),
    'X in0 in1 in2 0 0 0 0 CHANNEL','.control','set wr_singlescale','set wr_vecnames','set numdgt=17',
    'ac lin 1 100Meg 100Meg','wrdata result.dat i(V0) i(V1) i(V2)','quit','.endc','.end'].join('\n')+'\n'
  const solved=await solver({solver:'ngspice',args:['-n','-b','matrix.cir'],files:{'matrix.cir':deck},outputFiles:['result.dat']})
  const values=solved.files['result.dat'].trim().split(/\r?\n/)[1].trim().split(/\s+/).map(Number)
  // Independent complex Gaussian solve of Z*I=V, then add Y*V/2 at the input plane.
  const mul=(a,b)=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]]
  const div=(a,b)=>mul(a,[b[0]/(b[0]**2+b[1]**2),-b[1]/(b[0]**2+b[1]**2)])
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]]
  const relaxation=[omega**2/(pole**2+omega**2),pole*omega/(pole**2+omega**2)]
  const a=R.map((row,i)=>[...row.map((r,j)=>[r+S[i][j]*relaxation[0],omega*L[i][j]+S[i][j]*relaxation[1]]),[voltage[i],0]])
  for(let k=0;k<3;k++) for(let i=k+1;i<3;i++) {
    const ratio=div(a[i][k],a[k][k])
    for(let j=k;j<4;j++)a[i][j]=sub(a[i][j],mul(ratio,a[k][j]))
  }
  const current=Array(3)
  for(let i=2;i>=0;i--) {
    let value=a[i][3]
    for(let j=i+1;j<3;j++)value=sub(value,mul(a[i][j],current[j]))
    current[i]=div(value,a[i][i])
  }
  for(let i=0;i<3;i++) {
    const shunt=voltage.reduce((sum,v,j)=>[sum[0]+v*D[i][j]*pole*relaxation[0]/2,
      sum[1]+v*(omega*(C[i][j]-D[i][j])+D[i][j]*pole*relaxation[1])/2],[0,0])
    for(let part=0;part<2;part++)assert.ok(Math.abs(values[1+2*i+part]+current[i][part]+shunt[part])<1e-9)
  }
})

test('native primitive netlist executes twelve coupled-capable lanes without a device lane cap',async()=>{
  const size=12
  const diagonal=v=>Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>i===j?v:0))
  const stage=channelStage({R:diagonal(2),L:diagonal(1e-9),C:diagonal(1e-12)})
  const inputs=Array.from({length:size},(_,i)=>`in${i}`)
  const deck=['Twelve lanes',channelSpice([stage],size),...inputs.map((node,i)=>`V${i} ${node} 0 AC ${i===0?1:0}`),
    `X ${inputs.join(' ')} ${inputs.map(()=>'0').join(' ')} 0 CHANNEL`,'.control','set wr_singlescale','set wr_vecnames',
    'ac lin 1 100Meg 100Meg',`wrdata result.dat ${inputs.map((_,i)=>`i(V${i})`).join(' ')}`,'quit','.endc','.end'].join('\n')+'\n'
  const result=await solver({solver:'ngspice',args:['-n','-b','matrix.cir'],files:{'matrix.cir':deck},outputFiles:['result.dat']})
  const row=result.files['result.dat'].trim().split(/\r?\n/)[1].trim().split(/\s+/).map(Number)
  assert.equal(row.length,25)
  assert.ok(Math.abs(row[1]+2/(4+(2*Math.PI*.1)**2))<1e-8)
  assert.ok(row.slice(3).every(v=>Math.abs(v)<1e-12))
})

test('native supply-pin package parasitics execute with a physical pulse without omitting admitted bytes',async()=>{
  const input=inMemoryInput()
  input.ibisSources['models/test.ibs']=Buffer.from(input.ibisSources['models/test.ibs'].toString().replace('[Pin]','[Package]\nR_pkg .1 .1 .1\nL_pkg 2n 2n 2n\nC_pkg .2p .2p .2p\n[Pin]'))
  for(const model of input.circuitJson.filter(r=>r.type==='simulation_ibis_model'))model.include_package_parasitics=true
  const result=await runPipeline({...input,runSolver:solver})
  const run=result.experiments[0]
  assert.ok(run.waveform.rows.length>2)
  assert.ok(run.waveform.rows.some(row=>Math.abs(row[1])>1),'physical switching reaches the measured channel')
  for(const model of run.assembly) {
    assert.equal(model.metadata.packagePolicy,'vendor')
    assert.deepEqual(model.metadata.omissions,[])
    assert.ok(model.metadata.packageData.mappedPins.some(p=>p.inductanceHenries>0))
  }
})

test('saving requested voltages preserves internal branch-current controlled sources bit for bit',async()=>{
  const waveforms=[]
  for(const saved of ['all','v(out)']) {
    const deck=['Unsaved branch control','VDRIVE in 0 PULSE(0 1 1n .1n .1n 2n 4n)',
      'RLOAD in sense 1','VSENSE sense 0 0','BOUTPUT out 0 V={i(VSENSE)}','ROUT out 0 1000',
      '.control','set norefvalue','set wr_singlescale','set wr_vecnames','set numdgt=17',`save ${saved}`,
      'tran .05n 10n','wrdata result.dat v(out)','quit','.endc','.end'].join('\n')+'\n'
    const result=await solver({solver:'ngspice',args:['-n','-b','control.cir'],files:{'control.cir':deck},outputFiles:['result.dat']})
    waveforms.push(result.files['result.dat'])
  }
  assert.equal(waveforms[0],waveforms[1])
  assert.ok(waveforms[0].split('\n').some(line=>Number(line.trim().split(/\s+/)[1])>.9))
})
