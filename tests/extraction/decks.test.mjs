// Copied from tests/general.test.mjs: the single-lane extraction/reduction test. Assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import {geometryFromCircuitJson} from '../../src/board/index.js'
import {fastHenryDeck,fasterCapDeck,loopImpedance,referenceCapacitance} from '../../src/extraction/index.js'
import {circuit,physical} from '../fixtures/general.mjs'
import {groundPlaneFixture} from '../fixtures/ground-plane.ts'

test('one signal extraction retains its explicit return and correct 2x2 reduction',()=>{
  const m={...physical,lanes:[physical.lanes[0]]}
  const geometry=geometryFromCircuitJson(circuit,m)
  assert.equal(geometry.cells[0].conductors.length,2)
  assert.equal((fastHenryDeck(geometry.cells[0],m.extraction).match(/\.external /g)??[]).length,2)
  assert.equal(Object.keys(fasterCapDeck(geometry.cells[0],m.extraction)).length,3)
  assert.deepEqual(loopImpedance([[2,.1],[.1,3]]),[[4.8]])
  const C=referenceCapacitance([[4,-1],[-1,3]])
  assert.ok(Math.abs(C.matrix[0][0]-2.2)<1e-15)
})

test('finely sampled curved traces coalesce sub-width FastHenry chords while preserving board geometry and exact DC resistance (#46)',()=>{
  const stepCount=64
  const radiusMm=2.5
  const curvePoints=[]
  for(let index=0;index<=stepCount;index++){
    const angle=-Math.PI/2+(index/stepCount)*0.215
    const x=1.5+radiusMm*Math.cos(angle)
    const y=-0.375+radiusMm+radiusMm*Math.sin(angle)
    curvePoints.push([x,y])
  }
  const filamentAtOffset=(a,b,offsetM,zM)=>{
    const x0=a[0]*1e-3
    const y0=a[1]*1e-3
    const x1=b[0]*1e-3
    const y1=b[1]*1e-3
    const dx=x1-x0
    const dy=y1-y0
    const length=Math.hypot(dx,dy)
    const wx=-dy/length
    const wy=dx/length
    return {x0:x0+offsetM*wx,y0:y0+offsetM*wy,z0:zM,x1:x1+offsetM*wx,y1:y1+offsetM*wy,z1:zM,length,ux:dx/length,uy:dy/length}
  }
  const hasParallelOverlapSingularity=(first,second)=>{
    const dot=first.ux*second.ux+first.uy*second.uy
    if(Math.abs(1-Math.abs(dot))>=1e-4) return false
    const dx1=first.x1-first.x0
    const dy1=first.y1-first.y0
    const dx2=second.x1-second.x0
    const dy2=second.y1-second.y0
    const denom=dx1*dy2-dy1*dx2
    if(Math.abs(denom)<1e-24) return false
    const rx=second.x0-first.x0
    const ry=second.y0-first.y0
    const t=(rx*dy2-ry*dx2)/denom
    const u=(rx*dy1-ry*dx1)/denom
    return t>1e-6&&t<1-1e-6&&u>1e-6&&u<1-1e-6
  }
  const rawFirst=filamentAtOffset(curvePoints[10],curvePoints[11],0.375e-4,0.0007911)
  const rawSecond=filamentAtOffset(curvePoints[11],curvePoints[12],0.375e-4,0.0007911)
  assert.ok(hasParallelOverlapSingularity(rawFirst,rawSecond))

  const fixture=groundPlaneFixture()
  const trace=fixture.circuit.find(e=>e.type==='pcb_trace'&&e.pcb_trace_id==='t0')
  trace.route.splice(1,0,...curvePoints.map(([x,y])=>({route_type:'wire',x,y,width:.1,layer:'top'})))

  const cell=geometryFromCircuitJson(fixture.circuit,fixture.modeling).cells[0]
  const rawSegments=cell.routedCopper.signals[0].segments
  assert.equal(rawSegments.length,curvePoints.length+1)

  const deck=fastHenryDeck(cell,fixture.modeling.extraction)
  const nodes=new Map()
  const bars=[]
  for(const line of deck.split('\n')){
    const nodeMatch=line.match(/^(N(?:0[ab]|t\d+))\s+x=([\deE+.-]+)\s+y=([\deE+.-]+)\s+z=([\deE+.-]+)$/)
    if(nodeMatch){
      nodes.set(nodeMatch[1],[Number(nodeMatch[2])*1000,Number(nodeMatch[3])*1000,Number(nodeMatch[4])*1000])
    }
    const barMatch=line.match(/^E\d+\s+(N\S+)\s+(N\S+)\s+w=([\deE+.-]+)\s+h=([\deE+.-]+)\s+sigma=([\deE+.-]+)/)
    if(barMatch&&nodes.has(barMatch[1])&&nodes.has(barMatch[2])){
      bars.push({
        a:nodes.get(barMatch[1]),
        b:nodes.get(barMatch[2]),
        widthM:Number(barMatch[3]),
        heightM:Number(barMatch[4]),
        sigma:Number(barMatch[5]),
      })
    }
  }
  assert.ok(bars.length>=4&&bars.length<rawSegments.length)
  assert.deepEqual(bars[0].a.slice(0,2),[0,-.375])
  assert.deepEqual(bars.at(-1).b.slice(0,2),[10,-.375])
  for(const bar of bars){
    const chordM=Math.hypot(bar.b[0]-bar.a[0],bar.b[1]-bar.a[1])*1e-3
    assert.ok(chordM>=bar.widthM)
  }
  for(let i=0;i<bars.length;i++){
    for(let j=i+1;j<bars.length;j++){
      for(const firstOffset of [-0.375e-4,0,0.375e-4]){
        for(const secondOffset of [-0.375e-4,0,0.375e-4]){
          const first=filamentAtOffset(bars[i].a,bars[i].b,firstOffset,bars[i].a[2]*1e-3)
          const second=filamentAtOffset(bars[j].a,bars[j].b,secondOffset,bars[j].a[2]*1e-3)
          assert.ok(!hasParallelOverlapSingularity(first,second))
        }
      }
    }
  }
  const analyticR=rawSegments.reduce((sum,s)=>sum+Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1],s.b[2]-s.a[2])*1e-3/((s.conductivitySm??cell.conductivitySm)*(s.widthMm*1e-3)*(s.thicknessMm*1e-3)),0)
  const deckR=bars.reduce((sum,b)=>sum+Math.hypot(b.b[0]-b.a[0],b.b[1]-b.a[1],b.b[2]-b.a[2])*1e-3/(b.sigma*b.widthM*b.heightM),0)
  assert.ok(Math.abs(deckR-analyticR)/analyticR<1e-12)
})

