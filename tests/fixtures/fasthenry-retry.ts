import { nativeChannel, modeling } from './native-channel.js'
import { geometryFromCircuitJson } from '../../src/geometry.js'
import type { RunSolver, SolverRequest, FileMap } from '../../src/solver.js'

export { modeling }

export const geometry = geometryFromCircuitJson(await nativeChannel(), modeling)
const cell = geometry.cells[0]
const signalR = cell.routedCopper!.signals[0].segments.reduce((sum,s) => sum + Math.hypot(...s.a.map((v,i)=>v-s.b[i])) * 1000 / ((s.conductivitySm??cell.conductivitySm)*s.widthMm*s.thicknessMm),0)
export const matrix = `Row 1: N0a to N0b\nRow 2: N1a to N1b\nImpedance matrix for frequency = 1e+08 2 x 2\n${signalR} 1j 0 0j\n0 0j .01 1j\n`
const warning = 'Warning: Convergence not reached. Stopping iteration...'
export const reachedCap = new Error('FasterCap reached')

type Setup = {phase?: 'coarse'|'refinement', stream?: 'stdout'|'stderr', extra?: string, retryFails?: boolean, retryBadMesh?: boolean, failure?: 'throw'|'exit'|'missing'}
export function setup({phase,stream='stdout',extra='',retryFails=false,retryBadMesh=false,failure}:Setup = {}) {
  const calls: SolverRequest[] = [],files: FileMap = {}
  let segCount=0
  const solve: RunSolver = async request => {
    calls.push(request)
    if(request.solver==='fastercap') throw reachedCap
    const cube=request.args[1]==='cube'
    if(!cube) segCount++
    if(failure==='throw') throw new Error('native_timeout: interrupted')
    if(failure==='exit') return {stdout:warning,stderr:'',files:{'Zc.mat':matrix},exitCode:2}
    if(failure==='missing') return {stdout:warning,stderr:'',files:{} as FileMap}
    const failed=(cube && retryFails)||(!cube&&((phase==='coarse'&&segCount===1)||(phase==='refinement'&&segCount===2)))
    const resultMatrix=failed?'unconverged matrix':cube&&retryBadMesh?matrix.replace(`${signalR} 1j`,`${signalR*2} 1j`):matrix
    return {stdout:stream==='stdout'&&failed?`${warning}\n${extra}`:extra,stderr:stream==='stderr'&&failed?warning:'',files:{'Zc.mat':resultMatrix}}
  }
  return {calls,files,solve}
}
