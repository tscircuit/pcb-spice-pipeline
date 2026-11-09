import { numerics, max } from '../kernel'
import type { CrossSection } from '../board'
import { fail } from './diagnostics'
import { solve, type Matrix } from './linalg'
import { fieldGrid, potentials } from './grid'

export const epsilon0 = numerics.epsilon0
export const mu0 = numerics.mu0
export interface BemSurface { thicknessM: number; conductivitySm: number; matrix: Matrix }
export interface BemResult { surfaces?: BemSurface[]; C: Matrix; C0: Matrix; loss: Matrix; surface: Matrix; steps: { panels: number; kind?: 'mesh'|'domain'; extentMm?: number; residual: number | null; rawResidual: number | null; entries?: Record<string,number> | null; rawEntries?: Record<string,number> | null }[] }
/** Strict entry-wise relative convergence, including arbitrarily small mutual terms. */
export function matrixResidual(a: Matrix, b: Matrix): number {
  return b.reduce((largest,row,i)=>row.reduce((current,v,j)=>Math.max(current,v===0 ? Number(a[i][j]!==0) : Math.abs(v-a[i][j])/Math.abs(v)),largest),0)
}
/** Eliminates floating neutral conductors, returning their voltage response to each active excitation. */
function voltages(c: Matrix, active: number): Matrix {
  const v=c.map((_,i)=>Array.from({length:active},(__,j)=>Number(i===j)))
  if (active<c.length) {
    const floating=solve(c.slice(active).map(row=>row.slice(active)),c.slice(active).map(row=>row.slice(0,active)))
    for (let i=active;i<c.length;i++) v[i]=floating[i-active].map(x=>-x)
  }
  return v
}
/** Energy and Gauss flux of one sparse field solution. The same sparse factor serves every excitation. */
function field(slice: CrossSection, density: number, extent: number, vacuum: boolean): { C:Matrix; loss:Matrix; surfaces:BemSurface[]; size:number } {
  const grid=fieldGrid(slice,density,extent,vacuum)
  const groups=max(slice.conductors.map(c=>c.group))+1
  const active=slice.activeCount??groups
  const u=potentials(grid,groups)
  /** Potential at a dielectric cell or a Dirichlet conductor, for all full-system excitations. */
  const at=(index:number,j:number):number=>index>=0?u[j][index]:Number(-index-2===j)
  const full=Array.from({length:groups},()=>Array(groups).fill(0)) as Matrix
  for (const e of grid.edges) {
    const d=Array.from({length:groups},(_,j)=>at(e.a,j)-at(e.b,j))
    for (let i=0;i<groups;i++) for (let j=0;j<groups;j++) full[i][j]+=epsilon0*e.weight*d[i]*d[j]
  }
  const v=voltages(full,active)
  const C=Array.from({length:active},()=>Array(active).fill(0)) as Matrix
  const loss=C.map(row=>row.map(()=>0))
  const surfaces:BemSurface[]=[]
  const faceKeys=slice.conductors.map(c=>`${(c.penetrationMm??c.zMax-c.zMin)/1000},${c.conductivitySm}`)
  for (const key of new Set(faceKeys)) {
    const [thicknessM,conductivitySm]=key.split(',').map(Number)
    surfaces.push({thicknessM,conductivitySm,matrix:C.map(row=>row.map(()=>0))})
  }
  const fluxes: {metal:number;length:number;q:number[]}[]=[]
  for (const e of grid.edges) {
    const d=Array.from({length:active},(_,j)=>v.reduce((sum,row,k)=>sum+row[j]*(at(e.a,k)-at(e.b,k)),0))
    for (let i=0;i<active;i++) for (let j=0;j<active;j++) {
      C[i][j]+=epsilon0*e.weight*d[i]*d[j]
      loss[i][j]+=epsilon0*e.loss*d[i]*d[j]
    }
    if (vacuum&&e.metal>=0) fluxes.push({metal:e.metal,length:e.length,q:d.map(value=>value*epsilon0*e.weight)})
  }
  if (vacuum) {
    const inverse=solve(C,C.map((row,i)=>row.map((_,j)=>Number(i===j))))
    for (const f of fluxes) {
      const current=Array.from({length:active},(_,j)=>f.q.reduce((sum,q,k)=>sum+q*inverse[k][j],0))
      const face=surfaces.find(s=>`${s.thicknessM},${s.conductivitySm}`===faceKeys[f.metal])!
      for (let i=0;i<active;i++) for (let j=0;j<active;j++) face.matrix[i][j]+=current[i]*current[j]/f.length/Math.sqrt(face.conductivitySm)
    }
  }
  return {C,loss,surfaces,size:grid.size}
}
/** Sparse conservative Laplace solve; independently converge grid and open-domain extent with no step limit. */
export function solveCrossSection(slice: CrossSection, progress: (message: string) => void = () => {}): BemResult {
  if (!slice.conductors.length || !slice.conductors.some(c=>c.group===-1) || !slice.conductors.some(c=>c.group>=0) || slice.conductors.some(c => ![c.xMin,c.xMax,c.zMin,c.zMax,c.conductivitySm].every(Number.isFinite) || c.xMin>=c.xMax || c.zMin>=c.zMax || c.conductivitySm<=0)) fail('mesh_convergence','Finite positive metal cross-sections, conductivity, signal and reference are required')
  if (slice.dielectrics.some(d=>![d.xMin,d.xMax,d.zMin,d.zMax,d.er,d.lossTangent].every(Number.isFinite)||d.xMin>=d.xMax||d.zMin>=d.zMax||d.er<=0||d.lossTangent<0)) fail('mesh_convergence','Dielectric rectangles need finite positive extent/permittivity and nonnegative loss tangent')
  const rects=[...slice.conductors,...slice.dielectrics]
  let extent=Math.max(max(rects.map(c=>c.zMax))-rects.reduce((small,c)=>Math.min(small,c.zMin),Infinity),max(rects.map(c=>c.xMax))-rects.reduce((small,c)=>Math.min(small,c.xMin),Infinity))
  let density=numerics.gridInitialDensity as number
  let previous:Record<string,Matrix>|undefined
  let domain:Record<string,Matrix>|undefined
  let domainRaw:Record<string,Matrix>|undefined
  let estimate:Record<string,Matrix>|undefined
  let kind:'mesh'|'domain'='mesh'
  const steps:BemResult['steps']=[]
  for (;;) {
    const normal=field(slice,density,extent,false)
    const vacuum=field(slice,density,extent,true)
    const surface=normal.C.map((row,i)=>row.map((_,j)=>vacuum.surfaces.reduce((sum,f)=>sum+f.matrix[i][j],0)))
    const inverse=solve(vacuum.C,vacuum.C.map((row,i)=>row.map((_,j)=>Number(i===j))))
    const current:Record<string,Matrix>={C:normal.C,C0:vacuum.C,L:inverse,loss:normal.loss,surface,...Object.fromEntries(vacuum.surfaces.map((f,i)=>[`face${i}`,f.matrix]))}
    const old=kind==='mesh'?previous:domain
    const coarse=kind==='domain'?field(slice,density/numerics.gridRefinementRatio,extent,true):undefined
    const corrected=Object.fromEntries(Object.entries(current).map(([key,m])=>{
      const prior=coarse?(key==='surface'?coarse.C.map((row,i)=>row.map((_,j)=>coarse.surfaces.reduce((sum,f)=>sum+f.matrix[i][j],0))):key.startsWith('face')?coarse.surfaces[Number(key.slice(4))].matrix:undefined):previous?.[key]
      return [key,prior&&(key==='surface'||key.startsWith('face'))?m.map((row,i)=>row.map((v,j)=>(numerics.gridRefinementRatio**numerics.skinExtrapolationOrder*v-prior[i][j])/(numerics.gridRefinementRatio**numerics.skinExtrapolationOrder-1))):m]
    }))
    const rawOld=kind==='mesh'?previous:domainRaw
    const rawEntries=rawOld?Object.fromEntries(Object.entries(current).map(([key,m])=>[key,matrixResidual(rawOld[key],m)])):null
    const entries=kind==='mesh'?(estimate?Object.fromEntries(Object.entries(corrected).map(([key,m])=>[key,matrixResidual(estimate![key],m)])):null):old?Object.fromEntries(Object.entries(corrected).map(([key,m])=>[key,matrixResidual(old[key],m)])):null
    const residual=entries?max(Object.values(entries)):null
    steps.push({panels:normal.size,kind,extentMm:extent,residual,rawResidual:rawEntries?max(Object.values(rawEntries)):null,entries,rawEntries})
    progress(`2D sparse FV ${kind}: ${normal.size} cells; extent ${extent} mm; C/C0/L/skin/loss ${residual??'initial'} ${JSON.stringify(entries)}; target < ${numerics.meshRelativeChange}`)
    if (!Number.isFinite(residual??0)) fail('mesh_convergence','Nonfinite finite-volume refinement')
    if (kind==='mesh') {
      estimate=corrected
      previous=current
      if (residual!==null&&residual<numerics.meshRelativeChange) {
        domain=corrected
        domainRaw=current
        extent*=numerics.gridRefinementRatio
        kind='domain'
      } else density*=numerics.gridRefinementRatio
    } else if (residual!==null&&residual<numerics.meshRelativeChange) return {C:normal.C,C0:vacuum.C,loss:normal.loss,surface:corrected.surface,surfaces:vacuum.surfaces.map((f,i)=>({...f,matrix:corrected[`face${i}`]})),steps}
    else {
      domain=corrected
      domainRaw=current
      extent*=numerics.gridRefinementRatio
    }
  }
}
