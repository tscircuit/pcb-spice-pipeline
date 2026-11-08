import type { ExtractedStage, StageMatrices } from '../../src/extraction'
/** A declared constant passive multiport for netlist/native AC verification, independent of the field solver. */
export function channelStage(matrices: StageMatrices): ExtractedStage {
  const n = matrices.R.length
  const zero = matrices.R.map(row => row.map(() => 0))
  const fit = {poles: [1], weights: [0], relativeRms: 0, maxRelative: 0}
  const ports = Array.from({length:n}, (_,i)=>({lane:`D${i}`,from:`IN${i}`,to:`OUT${i}`}))
  return {...matrices,stage:0,profile:'declared-test-matrix',lengthM:.01,ports,cells:1,C0:matrices.C,G:zero,
    units:{R:'ohm',L:'H',C:'F',G:'S'},frequencyHz:1e8,band:{riseTimeSeconds:1e-9,bitRateHz:1e8},frequenciesHz:[],spectrum:[],
    skin:{matrix:zero,fit},dielectric:{matrix:zero,fit},mesh:[],sliceHash:'declared-test-matrix',
    geometry:{stage:0,profile:'declared-test-matrix',lengthM:.01,ports,start:[0,0],end:[10,0]},
  }
}
