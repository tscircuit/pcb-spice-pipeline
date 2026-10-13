import { fail } from './matrices.mjs'
export function waveformRows(text) {
  const rows=text.trim().split('\n').slice(1).map(r=>r.trim().split(/\s+/).map(Number))
  if(!rows.length||rows.some(r=>r.length!==7||r.some(v=>!Number.isFinite(v)))) fail('waveform','ngspice must generate finite time + six voltage columns')
  for(let i=1;i<rows.length;i++) if(rows[i][0]<=rows[i-1][0]) fail('waveform','Time samples must strictly increase')
  return rows
}
const crossings=(rows,col,start)=>rows.flatMap((r,i)=>{
  if(!i||r[0]<start) return []
  const a=rows[i-1],x=a[col],y=r[col]
  return x*y<0?[{time:a[0]+(r[0]-a[0])*(-x)/(y-x),rising:y>x}]:[]
})
export function measureWaveform(rows,s) {
  const valid=rows.filter(r=>r[0]>=s.excludeSeconds), out=crossings(rows,5,s.excludeSeconds),drive=crossings(rows,6,s.excludeSeconds)
  if(out.length<8||drive.length<8) fail('stimulus','Insufficient executed receiver transitions for clock eye')
  const driverIntervals=drive.slice(1).map((c,i)=>c.time-drive[i].time)
  if(driverIntervals.some(dt=>Math.abs(dt/s.uiSeconds-1)>.01)) fail('clock_ui','Executed driver half-period disagrees with declared UI by >1%')
  const delays=out.flatMap(c=>{
    const candidates=drive.filter(d=>d.rising===c.rising&&d.time<=c.time&&c.time-d.time<s.uiSeconds)
    return candidates.length?[c.time-candidates.at(-1).time]:[]
  }).sort((a,b)=>a-b)
  if(delays.length<8) fail('propagation','Unable to match enough source/receiver crossings')
  const phase=out[0].time,samples=[]
  let cycle=0
  for(let target=phase+s.uiSeconds/2;target<rows.at(-1)[0];target+=s.uiSeconds,cycle++) {
    const i=rows.findIndex(r=>r[0]>=target)
    if(i>0) {const a=rows[i-1],b=rows[i];samples.push({value:a[5]+(b[5]-a[5])*(target-a[0])/(b[0]-a[0]),expectedHigh:cycle%2===0?out[0].rising:!out[0].rising})}
  }
  const high=samples.filter(s=>s.expectedHigh).map(s=>s.value),low=samples.filter(s=>!s.expectedHigh).map(s=>s.value)
  if(!high.length||!low.length) fail('eye','Missing both clock levels at center')
  const spacing=out.slice(1).map((c,i)=>c.time-out[i].time)
  return {kind:'deterministic alternating DQS clock eye; no random data or injected jitter',samples:rows.length,receiverTransitions:out.length,steadyStateStartSeconds:s.excludeSeconds,uiSeconds:s.uiSeconds,eyePhaseSeconds:phase,differentialRangeV:[Math.min(...valid.map(r=>r[5])),Math.max(...valid.map(r=>r[5]))],eyeHeightAtCenterV:Math.min(...high)-Math.max(...low),propagationMedianSeconds:delays[Math.floor(delays.length/2)],propagationRangeSeconds:[delays[0],delays.at(-1)],crossingIntervalRangeSeconds:[Math.min(...spacing),Math.max(...spacing)],simulatedDurationSeconds:rows.at(-1)[0],limitations:['Clock eye only; not data BER, jitter-tolerance or JEDEC compliance','Propagation measured at external pads; excluded TI coupled package and surrounding board structures']}
}
