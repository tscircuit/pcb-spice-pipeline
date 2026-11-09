import type { CrossSection } from '../board'
import { fail } from './diagnostics'
import { numerics } from '../kernel'

export interface GridEdge { a: number; b: number; weight: number; loss: number; length: number; metal: number }
export interface FieldGrid { edges: GridEdge[]; size: number; width: number; height: number; x: number[]; z: number[]; ids:Int32Array }
/** Geometrically graded cells resolve each exact material/metal boundary without a uniform fine far field. */
function axis(cuts: number[], metal: number[], scale: number, extent: number, density: number): number[] {
  const physical = [...new Set(cuts)].sort((a,b)=>a-b)
  const lo = physical[0]-extent
  const hi = physical.at(-1)!+extent
  const anchors = [lo,...physical,hi]
  const result = [lo]
  for (let i=1;i<anchors.length;i++) {
    const a=anchors[i-1]
    const b=anchors[i]
    const half=(b-a)/2
    const left=metal.reduce((best,v)=>Math.min(best,Math.abs(a-v)),Infinity)
    const right=metal.reduce((best,v)=>Math.min(best,Math.abs(b-v)),Infinity)
    const base=scale/density**numerics.gridEdgePower
    const ratio=numerics.gridGrowth/Math.sqrt(density)
    const count=Math.max(1,Math.ceil(Math.log1p(half/(base+Math.min(left,right)))/Math.log1p(ratio)))
    const rate=Math.log1p(half/(base+Math.min(left,right)))/count
    for (let k=1;k<=count;k++) result.push(a+(base+Math.min(left,right))*Math.expm1(rate*k))
    for (let k=count-1;k>=0;k--) result.push(b-(base+Math.min(left,right))*Math.expm1(rate*k))
  }
  return result
}
/** Conservative two-point finite-volume discretization, with exact Dirichlet faces and insulating far boundary.
 * Coordinates cancel from capacitance weights; boundary-face lengths are converted to metres for loss.
 */
export function fieldGrid(slice: CrossSection, density: number, extent: number, vacuum: boolean): FieldGrid {
  const metal = slice.conductors
  const rects = [...metal,...slice.dielectrics]
  const scale = metal.reduce((small,c)=>Math.min(small,c.xMax-c.xMin,c.zMax-c.zMin),Infinity)
  const x = axis(rects.flatMap(c=>[c.xMin,c.xMax]),metal.flatMap(c=>[c.xMin,c.xMax]),scale,extent,density)
  const z = axis(rects.flatMap(c=>[c.zMin,c.zMax]),metal.flatMap(c=>[c.zMin,c.zMax]),scale,extent,density)
  const width = x.length-1
  const height = z.length-1
  const n = width*height
  const ids = new Int32Array(n)
  const owners = new Int32Array(n).fill(-1)
  const er = new Float64Array(n).fill(1)
  const tangent = new Float64Array(n)
  let size = 0
  for (let j=0;j<height;j++) for (let i=0;i<width;i++) {
    const k = j*width+i
    const px = (x[i]+x[i+1])/2
    const pz = (z[j]+z[j+1])/2
    const owner = metal.findIndex(c=>px>c.xMin&&px<c.xMax&&pz>c.zMin&&pz<c.zMax)
    owners[k] = owner
    ids[k] = owner<0 ? size++ : -metal[owner].group-2
    if (owner<0&&!vacuum) {
      const material = slice.dielectrics.find(d=>px>d.xMin&&px<d.xMax&&pz>d.zMin&&pz<d.zMax)
      er[k] = material?.er??1
      tangent[k] = material?.lossTangent??0
    }
  }
  const edges: GridEdge[] = []
  /** Adds each physical flux face once. A conductor's centre is replaced by its actual boundary. */
  const face = (a: number, b: number, ha: number, hb: number, length: number): void => {
    if (owners[a]>=0&&owners[b]>=0) return
    const ra = owners[a]<0 ? ha/er[a] : 0
    const rb = owners[b]<0 ? hb/er[b] : 0
    const resistance = ra+rb
    const weight = length/resistance
    edges.push({a:ids[a],b:ids[b],weight,loss:weight*(ra*tangent[a]+rb*tangent[b])/resistance,length:length/1000,metal:Math.max(owners[a],owners[b])})
  }
  for (let j=0;j<height;j++) for (let i=0;i<width;i++) {
    const a = j*width+i
    if (i+1<width) face(a,a+1,(x[i+1]-x[i])/2,(x[i+2]-x[i+1])/2,z[j+1]-z[j])
    if (j+1<height) face(a,a+width,(z[j+1]-z[j])/2,(z[j+2]-z[j+1])/2,x[i+1]-x[i])
  }
  return {edges,size,width,height,x,z,ids}
}
/** Nested dissection keeps the exact sparse LDL factor small on the rectilinear graph. */
function ordering(grid: FieldGrid): Int32Array {
  const result:number[]=[]
  const cells=grid.ids
  /** Order children before their separating line, eliminating interiors before interfaces. */
  const visit=(x0:number,x1:number,z0:number,z1:number):void=>{
    if (x0>=x1||z0>=z1) return
    if (x1-x0>=z1-z0) {
      const mid=(x0+x1)>>1
      visit(x0,mid,z0,z1)
      visit(mid+1,x1,z0,z1)
      for (let z=z0;z<z1;z++) if (cells[z*grid.width+mid]>=0) result.push(cells[z*grid.width+mid])
    } else {
      const mid=(z0+z1)>>1
      visit(x0,x1,z0,mid)
      visit(x0,x1,mid+1,z1)
      for (let x=x0;x<x1;x++) if (cells[mid*grid.width+x]>=0) result.push(cells[mid*grid.width+x])
    }
  }
  visit(0,grid.width,0,grid.height)
  return Int32Array.from(result)
}
/** Exact sparse symmetric LDL factorization (CSC triangular storage), shared by every excitation.
 * Symbolic elimination-tree reach determines storage before the numeric left-looking factorization.
 */
export function potentials(grid: FieldGrid, groups: number): Float64Array[] {
  const {size,edges}=grid
  const order=ordering(grid)
  const inverse=new Int32Array(size)
  for (let i=0;i<size;i++) inverse[order[i]]=i
  const diagonal=new Float64Array(size)
  const columns=Array.from({length:size},()=>[] as {row:number;value:number}[])
  const rhs=Array.from({length:groups},()=>new Float64Array(size))
  for (const e of edges) {
    const a=e.a>=0?inverse[e.a]:e.a
    const b=e.b>=0?inverse[e.b]:e.b
    if (a>=0) diagonal[a]+=e.weight
    if (b>=0) diagonal[b]+=e.weight
    if (a>=0&&b>=0) columns[Math.max(a,b)].push({row:Math.min(a,b),value:-e.weight})
    else {
      const group=-(a<0?a:b)-2
      if (group>=0) rhs[group][Math.max(a,b)]+=e.weight
    }
  }
  const parent=new Int32Array(size).fill(-1)
  const flags=new Int32Array(size).fill(-1)
  const counts=new Int32Array(size)
  for (let k=0;k<size;k++) {
    flags[k]=k
    for (const e of columns[k]) for (let i=e.row;flags[i]!==k;i=parent[i]) {
      if (parent[i]===-1) parent[i]=k
      counts[i]++
      flags[i]=k
    }
  }
  const rows=new Int32Array(size+1)
  for (let i=0;i<size;i++) rows[i+1]=rows[i]+counts[i]
  if (rows[size]<0) fail('matrix_storage','Sparse factor exceeds typed-array index precision')
  const indices=new Int32Array(rows[size])
  const values=new Float64Array(rows[size])
  const d=new Float64Array(size)
  const y=new Float64Array(size)
  const pattern=new Int32Array(size)
  counts.fill(0)
  flags.fill(-1)
  for (let k=0;k<size;k++) {
    let top=size
    flags[k]=k
    y[k]=diagonal[k]
    for (const e of columns[k]) {
      y[e.row]+=e.value
      let length=0
      for (let i=e.row;flags[i]!==k;i=parent[i]) {
        pattern[length++]=i
        flags[i]=k
      }
      while (length>0) pattern[--top]=pattern[--length]
    }
    d[k]=y[k]
    y[k]=0
    for (;top<size;top++) {
      const i=pattern[top]
      const yi=y[i]
      y[i]=0
      const end=rows[i]+counts[i]
      for (let p=rows[i];p<end;p++) y[indices[p]]-=values[p]*yi
      const value=yi/d[i]
      d[k]-=value*yi
      indices[end]=k
      values[end]=value
      counts[i]++
    }
    if (!(d[k]>0)) fail('matrix_singular','Sparse Laplace factor lost positive definiteness')
  }
  return rhs.map((b,excitation)=>{
    const u=b.slice()
    for (let j=0;j<size;j++) for (let p=rows[j];p<rows[j+1];p++) u[indices[p]]-=values[p]*u[j]
    for (let j=0;j<size;j++) u[j]/=d[j]
    for (let j=size-1;j>=0;j--) for (let p=rows[j];p<rows[j+1];p++) u[j]-=values[p]*u[indices[p]]
    const field=Float64Array.from(inverse,i=>u[i])
    const balance=new Float64Array(size)
    let total=0
    for (const e of edges) {
      const a=e.a>=0?field[e.a]:Number(-e.a-2===excitation)
      const valueB=e.b>=0?field[e.b]:Number(-e.b-2===excitation)
      const flux=e.weight*(a-valueB)
      if (e.a>=0) balance[e.a]+=flux
      if (e.b>=0) balance[e.b]-=flux
      total+=Math.abs(flux)
    }
    const residual=balance.reduce((sum,value)=>sum+Math.abs(value),0)/total
    if (!Number.isFinite(residual)||residual>numerics.fieldBalanceRelative) fail('mesh_convergence',`Sparse field Gauss-balance residual ${residual} exceeds ${numerics.fieldBalanceRelative}`)
    return field
  })
}
