import test from 'node:test'
import assert from 'node:assert/strict'
import clipping from 'polygon-clipping'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { qualityMesh, qualitySidePanels, type QualityMeshOptions } from '../src/quality-mesh.js'
import { copperFasterCapDeck, surfacePanels } from '../src/copper.js'
import { geometryFromCircuitJson, fasterCapDeck } from '../src/geometry.js'
import { groundPlaneFixture, routedGroundPlaneFixture } from './fixtures/ground-plane.js'
import { initSync, triangulate } from '../src/vendor/spade/mesh.js'

type Point = [number,number]
const signedArea = (r: Point[]) => r.reduce((s,p,i) => { const q=r[(i+1)%r.length]; return s+p[0]*q[1]-p[1]*q[0] },0)/2
const close = (r: Point[]) => [...r,r[0]]
const options = { maxPanelLengthMm: 1, maxAreaMm2: .2 }
function audit(rings: Point[][], settings: QualityMeshOptions = options) {
  const before = structuredClone(rings), mesh = qualityMesh(rings,settings), triangles: Point[][] = []
  let area = 0
  for (let i=0;i<mesh.indices.length;i+=3) {
    const t=mesh.indices.slice(i,i+3).map(i=>mesh.points[i]), a=signedArea(t)
    assert.ok(a>0 && a<=(settings.maxAreaMm2??.5)*(1+1e-10))
    for(let j=0;j<3;j++) assert.ok(Math.hypot(t[j][0]-t[(j+1)%3][0],t[j][1]-t[(j+1)%3][1])<=settings.maxPanelLengthMm)
    triangles.push(t); area+=a
  }
  // Independent polygon boolean audit checks coverage, holes, and overlap.
  const polygons=triangles.map(t=>[close(t)] as Point[][])
  const union=clipping.union(polygons[0],...polygons.slice(1))
  const difference=clipping.xor(union,rings.map(close))
  const unionArea=union.reduce((s,p)=>s+Math.abs(signedArea(p[0]))-p.slice(1).reduce((s,r)=>s+Math.abs(signedArea(r)),0),0)
  assert.ok(difference.reduce((s,p)=>s+p.reduce((s,r)=>s+Math.abs(signedArea(r)),0),0)<1e-12)
  assert.ok(Math.abs(area-unionArea)<1e-10)
  assert.deepEqual(rings,before)
  return mesh
}

test('quality caps preserve concavity, multiple holes, winding, area and immutable input', () => {
  const rings: Point[][]=[[[0,0],[6,0],[6,4],[4,4],[4,3],[2,3],[2,4],[0,4]],[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5]],[[4.5,1],[4.5,2],[5.5,2],[5.5,1]]]
  const a=audit(rings), b=audit(rings.map(r=>[...r].reverse()))
  assert.equal(a.trianglesBelowTarget,0)
  assert.ok(a.minAngleDeg>=15-1e-8 && b.minAngleDeg>=15-1e-8)
  assert.deepEqual(qualityMesh(rings,options),a,'cached synchronous WASM calls are deterministic and independent')
})

test('edge bound is enforced even when every raw Spade triangle meets the area bound', () => {
  const rings: Point[][]=[[[0,0],[10,0],[10,.1],[0,.1]]]
  initSync({module:readFileSync(new URL('../src/vendor/spade/mesh_bg.wasm',import.meta.url))})
  const raw=triangulate(new Float64Array(rings.flat(2)),new Uint32Array([0,1,1,2,2,3,3,0]),1,.5,10000)
  try {
    const p=raw.points, ids=raw.triangles
    assert.ok(raw.complete)
    assert.ok(Array.from(ids).some((id,i)=>{
      const other=ids[i-i%3+(i+1)%3]
      return Math.hypot(p[2*id]-p[2*other],p[2*id+1]-p[2*other+1])>.2
    }))
  } finally { raw.free() }
  audit(rings,{maxPanelLengthMm:.2,maxAreaMm2:.5,minAngleDeg:1})
})

test('acute original corners retain their geometry without claiming a universal angle bound', () => {
  const mesh=audit([[[0,0],[4,0],[4,.05]]],{maxPanelLengthMm:1,maxAreaMm2:.5})
  assert.ok(mesh.minAngleDeg<15 && mesh.trianglesBelowTarget>0)
})

test('invalid parameters, degeneracy, conflicts and exhausted budgets fail without fallback', () => {
  const square: Point[][]=[[[0,0],[4,0],[4,4],[0,4]]]
  for(const settings of [
    ...[0,-1,NaN,Infinity].map(maxPanelLengthMm=>({maxPanelLengthMm})),
    ...[0,-1,NaN,Infinity].map(maxAreaMm2=>({...options,maxAreaMm2})),
    ...[0,-1,31,NaN,Infinity].map(minAngleDeg=>({...options,minAngleDeg})),
    ...[0,2,3.1,1000001,NaN,Infinity].map(maxVertices=>({...options,maxVertices})),
    ...[0,-1,1.1,2000001,NaN,Infinity].map(maxPanels=>({...options,maxPanels})),
  ]) assert.throws(()=>qualityMesh(square,settings),/quality_mesh: Invalid parameters/)
  for(const rings of [[],[[[0,0],[1,1]]],[[[0,0],[1,1],[2,2]]],[[[0,0],[1,0],[1,1],[0,0]]],[[[0,0],[Infinity,1],[1,0]]]] as Point[][][]) assert.throws(()=>qualityMesh(rings,options),/quality_mesh:/)
  assert.throws(()=>qualityMesh([[[0,0],[4,4],[0,3],[3,0]]],options),/Conflicting input constraints/)
  assert.throws(()=>qualityMesh([...square,[[5,5],[6,5],[6,6],[5,6]]],options),/Boundary/)
  assert.throws(()=>qualityMesh(square,{...options,maxVertices:4}),/refinement incomplete/)
  assert.throws(()=>qualityMesh(square,{maxPanelLengthMm:.1,maxAreaMm2:100,minAngleDeg:1,maxVertices:100}),/Edge-length refinement exhausted/)
  assert.throws(()=>qualityMesh(square,{...options,maxPanels:1}),/Panel budget exceeded/)
  assert.throws(()=>qualityMesh(square,{maxPanelLengthMm:.1,maxAreaMm2:100,minAngleDeg:1,maxPanels:100}),/Panel budget exceeded during edge-length refinement/)
  audit(square) // failure does not invalidate subsequent calls
})

function panels(text: string, kind: string) { return text.split('\n').filter(s=>s.startsWith(kind+' ')) }
type XYZ = [number,number,number]
const vertices = (row: string): XYZ[] => { const p=row.split(' ').slice(2).map(Number); return Array.from({length:p.length/3},(_,i)=>p.slice(3*i,3*i+3) as XYZ) }
const sideTriangles = (text: string) => panels(text,'T').map(vertices).filter(p=>!p.every(v=>v[2]===p[0][2]))
const delta = (a: XYZ,b: XYZ) => a.map((v,i)=>v-b[i]) as XYZ
const cross3 = (a: XYZ,b: XYZ): XYZ => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
function triangleBounds(p: XYZ[], settings: QualityMeshOptions, side = true) {
  const e=p.map((a,i)=>Math.hypot(...delta(a,p[(i+1)%3]))), twiceArea=Math.hypot(...cross3(delta(p[1],p[0]),delta(p[2],p[0])))
  assert.ok(p.flat().every(Number.isFinite) && twiceArea>0)
  assert.ok(e.every(v=>v<=settings.maxPanelLengthMm),`triangle diagonal/edge ${Math.max(...e)}`)
  assert.ok(twiceArea/2<=(settings.maxAreaMm2??.5)*(1+1e-10))
  const angle=Math.min(...e.map((s,i)=>Math.atan2(twiceArea,(s*s+e[(i+1)%3]**2-e[(i+2)%3]**2)/2)*180/Math.PI))
  if(side) assert.ok(angle>=(settings.minAngleDeg??15)-1e-8,`side angle ${angle}`)
  return twiceArea/2
}

// Independent parent-plane projection and polygon boolean audit: no gaps,
// overlaps, changed normals, lost fine faces or moved side boundaries.
function auditSides(original: string, refined: string, settings: QualityMeshOptions) {
  assert.equal(panels(refined,'Q').length,0)
  const parents=panels(original,'Q').map(vertices), groups=parents.map(()=>[] as Point[][])
  for(const p of sideTriangles(refined)) {
    triangleBounds(p,settings)
    const candidates=parents.flatMap((q,i)=>{
      const d=delta(q[1],q[0]), width=Math.hypot(...d), projected=p.map(v=>[(delta(v,q[0])[0]*d[0]+delta(v,q[0])[1]*d[1])/width,v[2]-q[0][2]] as Point)
      if(!p.every((v,j)=>Math.abs(d[0]*(v[1]-q[0][1])-d[1]*(v[0]-q[0][0]))<=1e-10*width && projected[j][0]>=-1e-10 && projected[j][0]<=width+1e-10 && projected[j][1]>=-1e-10 && projected[j][1]<=q[3][2]-q[0][2]+1e-10)) return []
      const normal=cross3(delta(p[1],p[0]),delta(p[2],p[0])), expected=cross3(delta(q[1],q[0]),delta(q[3],q[0]))
      assert.ok(normal.reduce((s,v,j)=>s+v*expected[j],0)>0,'parent side winding retained, including holes')
      return [{i,projected}]
    })
    assert.equal(candidates.length,1,'each side triangle belongs to one original rectangle')
    groups[candidates[0].i].push(candidates[0].projected)
  }
  for(const [i,q] of parents.entries()) {
    const group=groups[i], w=Math.hypot(...delta(q[1],q[0])), h=q[3][2]-q[0][2]
    assert.ok(group.length>=2 && group.length%2===0)
    const union=clipping.union([close(group[0])],...group.slice(1).map(t=>[close(t)])), difference=clipping.xor(union,[[[0,0],[w,0],[w,h],[0,h],[0,0]]])
    assert.ok(difference.reduce((s,p)=>s+p.reduce((s,r)=>s+Math.abs(signedArea(r)),0),0)<Math.max(1e-12,w*h*1e-9))
    assert.ok(Math.abs(group.reduce((s,t)=>s+Math.abs(signedArea(t)),0)-w*h)<Math.max(1e-12,w*h*1e-9))
  }
}
function volume(text: string) {
  let v=0
  for(const row of text.split('\n').filter(s=>/^[TQ] /.test(s))) {
    const coords=row.split(' ').slice(2).map(Number), p=Array.from({length:coords.length/3},(_,i)=>coords.slice(i*3,i*3+3))
    for(let i=1;i<p.length-1;i++) { const [a,b,c]=[p[0],p[i],p[i+1]]; v+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6 }
  }
  return v
}

function assertClosed(text: string) {
  const triangles=panels(text,'T').map(vertices), key=(p: XYZ)=>p.map(v=>v.toPrecision(12)).join(','), points=[...new Map(triangles.flat().map(p=>[key(p),p])).values()]
  const edges=new Map<string,{count:number;orientation:number}>()
  for(const p of triangles) for(let i=0;i<3;i++) {
    const a=p[i], d=delta(p[(i+1)%3],a), size2=d.reduce((s,v)=>s+v*v,0)
    // Split collinear incidence at all vertices to account for documented
    // cap/side T-junctions; this verifies geometric closure, not shared indexing.
    const cuts=points.flatMap(p=>{
      const t=delta(p,a).reduce((s,v,j)=>s+v*d[j],0)/size2
      return t>=-1e-10 && t<=1+1e-10 && Math.hypot(...delta(p,a).map((v,j)=>v-t*d[j]))<1e-10 ? [{p,t}] : []
    }).sort((a,b)=>a.t-b.t)
    for(let j=1;j<cuts.length;j++) {
      const a=key(cuts[j-1].p), b=key(cuts[j].p), id=[a,b].sort().join(' '), edge=edges.get(id)??{count:0,orientation:0}
      edge.count++; edge.orientation+=a<b?1:-1; edges.set(id,edge)
    }
  }
  for(const edge of edges.values()) assert.deepEqual(edge,{count:2,orientation:0},'closed surface has opposing edge incidences')
}

test('deck opt-in preserves side surfaces, cap z levels, outward normals and default deck bytes', () => {
  // Golden bytes from HEAD's original copper.ts, run in an isolated source copy.
  const fixtures = [
    [groundPlaneFixture,'6af7ba953160ab8694cb106c2176584d76de5269601df5442bed05bd8465c3b4'],
    [routedGroundPlaneFixture,'1052726ad6bc559afe5bc4d5c14aebb84f978896b65f86ea34b248101452e008'],
  ] as const
  for(const [fixture,hash] of fixtures) {
    const {circuit,modeling}=fixture(), cell=geometryFromCircuitJson(circuit,modeling).cells[0], before=structuredClone(cell)
    const original=fasterCapDeck(cell,modeling.extraction), quality=copperFasterCapDeck(cell,{...options,maxPanelLengthMm:modeling.extraction.maxPanelLengthMm})
    assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),hash)
    assert.deepEqual(copperFasterCapDeck(cell),original)
    assert.equal(quality['channel.lst'],original['channel.lst'])
    for(const name of ['sig0.txt','sig1.txt','return.txt']) {
      auditSides(original[name],quality[name],{...options,maxPanelLengthMm:modeling.extraction.maxPanelLengthMm})
      const normalAreas=(text:string)=>{
        const result=new Map<string,number>()
        for(const row of panels(text,'T')) {
          const p=row.split(' ').slice(2).map(Number), a=signedArea([[p[0],p[1]],[p[3],p[4]],[p[6],p[7]]]), key=`${p[2]}:${a>0}`
          if(p[2]!==p[5] || p[5]!==p[8]) continue
          assert.equal(p[2],p[5]); assert.equal(p[5],p[8])
          assert.ok(a!==0 && p.every(Number.isFinite))
          result.set(key,(result.get(key)??0)+a)
        }
        return result
      }
      const a=normalAreas(original[name]), b=normalAreas(quality[name])
      assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort())
      for(const [key,area] of a) assert.ok(Math.abs(area-b.get(key)!)<1e-9)
      assert.ok(volume(quality[name])>0)
      assert.ok(Math.abs(volume(quality[name])-volume(original[name]))<1e-10)
    }
    assert.deepEqual(cell,before)
  }
})

test('slab differences and disconnected solids preserve side surfaces and physical volume', () => {
  const solids=[{polygon:[[[0,0],[3,0],[3,2],[0,2]]] as Point[][],zMinMm:0,zMaxMm:.1},{polygon:[[[1,1],[2,1],[2,3],[1,3]]] as Point[][],zMinMm:.05,zMaxMm:.2},{polygon:[[[5,0],[6,0],[6,1],[5,1]]] as Point[][],zMinMm:0,zMaxMm:.1}]
  const a=surfacePanels(solids,'test'), b=surfacePanels(solids,'test',options)
  auditSides(a,b,options)
  assertClosed(b)
  assert.ok(Math.abs(volume(a)-volume(b))<1e-12)
  assert.equal(surfacePanels(solids,'test',options),b)
})

test('side rectangle aspect uses cot(angle), with strict bounds on both axes and the T diagonal', () => {
  for(const minAngleDeg of [1,15,30]) for(const [w,h] of [[4,1],[1,4],[5,.002],[.002,5],[1,1]]) {
    const settings={maxPanelLengthMm:.2,minAngleDeg,maxAreaMm2:.003}, triangles=[...qualitySidePanels([0,0],[w,0],0,h,settings)]
    const total=triangles.reduce((s,t)=>s+triangleBounds(t,settings),0)
    assert.ok(Math.abs(total-w*h)<w*h*1e-10)
  }
  const triangles=[...qualitySidePanels([0,0],[4,0],0,1,{maxPanelLengthMm:10,maxAreaMm2:10})]
  assert.equal(triangles.length,4,'ratio 4 would emit 14.036 degree triangles; cot(15) requires two cells')
  for(const t of triangles) triangleBounds(t,{maxPanelLengthMm:10,maxAreaMm2:10})
})

test('rotated and translated holed box keeps every outward side and the closed volume', () => {
  for(const angle of [0,.37,Math.PI/2]) {
    const transform=([x,y]: Point): Point=>[13+x*Math.cos(angle)-y*Math.sin(angle),-7+x*Math.sin(angle)+y*Math.cos(angle)]
    const polygon: Point[][]=[[[0,0],[1,0],[1,.8],[0,.8]],[[.3,.2],[.3,.5],[.6,.5],[.6,.2]]].map(r=>r.map(p=>transform(p as Point)))
    const solids=[{polygon,zMinMm:2,zMaxMm:2.035}], before=structuredClone(solids), settings={maxPanelLengthMm:.3,maxAreaMm2:.04}
    const original=surfacePanels(solids,'box'), refined=surfacePanels(solids,'box',settings)
    auditSides(original,refined,settings)
    assertClosed(refined)
    for(const t of panels(refined,'T').map(vertices)) triangleBounds(t,settings,false)
    assert.ok(Math.abs(volume(refined)-(.8-.09)*.035)<1e-12)
    assert.deepEqual(solids,before)
    assert.equal(surfacePanels(solids,'box',settings),refined)
  }
})

test('side subdivision retains fine positive faces and rejects overflow, precision collapse and resource exhaustion', () => {
  const fine=[...qualitySidePanels([0,0],[2e-8,0],0,1e-7,options)]
  assert.equal(fine.length,4)
  assert.ok(fine.every(t=>triangleBounds(t,options)<1e-14),'native small-area thresholds must never discard copper faces')
  assert.ok(Math.abs(fine.reduce((s,t)=>s+triangleBounds(t,options),0)-2e-15)<1e-29)
  for(const [a,b,low,high] of [ [[0,0],[0,0],0,1], [[0,0],[1,0],1,0], [[0,0],[Infinity,0],0,1], [[0,0],[1,0],0,Infinity] ] as [Point,Point,number,number][]) {
    assert.throws(()=>[...qualitySidePanels(a,b,low,high,options)],/quality_mesh: Invalid side/)
  }
  for(const settings of [{maxPanelLengthMm:Number.MIN_VALUE},{maxPanelLengthMm:1,maxAreaMm2:Number.MIN_VALUE},{...options,maxPanels:1}]) {
    const iterator=qualitySidePanels([0,0],[1,0],0,1,settings)
    assert.throws(()=>iterator.next(),/quality_mesh: Side panel budget exceeded/,'reject before emitting any partial side')
  }
  assert.throws(()=>[...qualitySidePanels([0,0],[1e-9,0],1e8,1e8+1e-6,options)],/coordinate resolution/)
  const solids=[{polygon:[[[0,0],[1,0],[1,1],[0,1]]] as Point[][],zMinMm:0,zMaxMm:1}], settings={maxPanelLengthMm:10,maxAreaMm2:10}
  const expected=surfacePanels(solids,'box',settings), count=panels(expected,'T').length
  assert.equal(count,12)
  assert.equal(surfacePanels(solids,'box',{...settings,maxPanels:count}),expected)
  assert.throws(()=>surfacePanels(solids,'box',{...settings,maxPanels:count-1}),/panel budget exceeded/i)
  assert.throws(()=>surfacePanels([...solids,{...solids[0],polygon:[[[3,0],[4,0],[4,1],[3,1]]]}],'box',{...settings,maxPanels:count}),/panel budget exceeded/i)
})

test('vendored bridge, pinned lockfile, notices and WASM match the shipped hash manifest', () => {
  const root=new URL('../src/vendor/spade/',import.meta.url)
  for(const line of readFileSync(new URL('SHA256SUMS',root),'utf8').trim().split('\n')) {
    const [hash,path]=line.split('  ')
    assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),hash,path)
  }
  assert.match(readFileSync(new URL('rust/Cargo.toml',root),'utf8'),/spade = "=2\.15\.1"/)
})
