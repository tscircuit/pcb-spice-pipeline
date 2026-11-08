// Independent finite-packet voltage-eye estimator. Uses every recorded piecewise-linear interval;
// no phase-sample grid, window budget, BER extrapolation or hidden iteration cap.
import {readFile,writeFile} from 'node:fs/promises'
import {numerics,min,max} from '../src/kernel/index'

export function interpolate(rows,column,time) {
  let lo=0
  let hi=rows.length-1
  if(time<=rows[lo][0])return rows[lo][column]
  if(time>=rows[hi][0])return rows[hi][column]
  while(hi-lo>1){
    const mid=Math.floor((lo+hi)/2)
    if(rows[mid][0]<=time)lo=mid
    else hi=mid}
  return rows[lo][column]+(rows[hi][column]-rows[lo][column])*(time-rows[lo][0])/(rows[hi][0]-rows[lo][0])
}
export function measureEye(rows,eye,pattern,thresholds) {
  const ui=eye.unitIntervalSeconds
  const origin=eye.timeOriginSeconds
  const first=Math.ceil((eye.startTimeSeconds-origin)/ui-numerics.eyeBoundaryToleranceUi)
  const last=Math.floor((Math.min(eye.endTimeSeconds,rows.at(-1)[0])-origin)/ui+numerics.eyeBoundaryToleranceUi)-1
  const bits=Array.from({length:last-first+1},(_,i)=>({start:origin+(first+i)*ui,high:pattern[(first+i)%pattern.length]==='1'}))
  if(!bits.some(b=>b.high)||!bits.some(b=>!b.high))throw Error('Eye requires observed high and low symbols')
  const phases=[...new Set([0,ui,...rows.filter(r=>r[0]>=eye.startTimeSeconds&&r[0]<=eye.endTimeSeconds).map(r=>{
    const cycle=(r[0]-origin)/ui
    return (cycle-Math.floor(cycle))*ui
  })])].sort((a,b)=>a-b)
  let height=-Infinity
  let width=0
  let intervalStart
  let intervalEnd
  for(let p=1;p<phases.length;p++) {
    const left=phases[p-1]
    const right=phases[p]
    const high=[]
    const low=[]
    for(const bit of bits)(bit.high?high:low).push([interpolate(rows,eye.column,bit.start+left),interpolate(rows,eye.column,bit.start+right)])
    const separation=u=>min(high.map(([a,b])=>a+(b-a)*u))-max(low.map(([a,b])=>a+(b-a)*u))
    height=Math.max(height,separation(0),separation(1))
    // Extremal envelopes can switch only at intersections of two affine waveforms.
    for(const set of [high,low])for(let i=0;i<set.length;i++)for(let j=i+1;j<set.length;j++) {
      const slope=(set[i][1]-set[i][0])-(set[j][1]-set[j][0])
      const u=(set[j][0]-set[i][0])/slope
      if(u>0&&u<1)height=Math.max(height,separation(u))
    }
    let a=0
    let b=1
    for(const [curves,threshold,sign] of [[high,thresholds[1],1],[low,thresholds[0],-1]])for(const [v0,v1] of curves) {
      const start=sign*(v0-threshold)
      const slope=sign*(v1-v0)
      if(slope>0)a=Math.max(a,-start/slope)
      else if(slope<0)b=Math.min(b,-start/slope)
      else if(start<0)b=-1
    }
    if(a<=b) {
      const start=left+(right-left)*a
      const end=left+(right-left)*b
      if(intervalEnd!==undefined&&start-intervalEnd<=ui*numerics.eyeInterpolationToleranceUi)intervalEnd=end
      else{intervalStart=start
        intervalEnd=end}
      width=Math.max(width,intervalEnd-intervalStart)
    }
  }
  return {heightV:height,widthSeconds:width,widthUi:width/ui,observedBits:bits.length,thresholdsV:thresholds,
    definition:'Maximum finite-packet high/low envelope separation; longest phase interval passing all declared thresholds; exact piecewise-linear waveform interpolation'}
}
if(process.argv[1]?.endsWith('measure-eyes.mjs')) {
  const measurements=[]
  const afterRoot=process.env.SI_MEASUREMENT_DIRECTORY??'runs/qualified'
  const names=process.argv.slice(2)
  for(const [group,root] of [['before','runs/before-eyes'],['after',afterRoot]])for(const name of names.length?names:['single-ended','differential-data']) {
    const directory=`${root}/${name}/experiments/simulation_experiment_0`
    const rows=(await readFile(`${directory}/waveform.csv`,'utf8')).trim().split(/\r?\n/).slice(1).map(line=>line.split(',').map(Number))
    const eyes=JSON.parse(await readFile(`${directory}/eyes.json`,'utf8'))
    const cj=JSON.parse(await readFile(`${root}/${name}/inputs/circuit.json`,'utf8'))
    const stimulus=cj.find(r=>r.type==='simulation_digital_stimulus')
    const pattern=stimulus.transmission_pattern.bits
    // Selected 3.3-V CMOS model declares VIL=.8 V, VIH=2 V. RS-485 receiver differential
    // guaranteed logic regions are beyond ±.2 V (SN65HVD72 datasheet §10.2.2.4);
    // these conservative comparison levels do not model its asymmetric failsafe thresholds.
    const thresholds=name==='single-ended'?[.8,2]:[-.2,.2]
    const eye=eyes[0]
    const result=measureEye(rows,eye,pattern,thresholds)
    measurements.push({group,name,probe:eye.name,...result})
  }
  await writeFile(`${afterRoot}/eye-comparison.json`,JSON.stringify(measurements,null,2))
  console.log(JSON.stringify(measurements,null,2))
}
