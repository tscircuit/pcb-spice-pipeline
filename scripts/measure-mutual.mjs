import {readFile,readdir} from 'node:fs/promises'
import {fittedStorage} from '../src/extraction/loss'
// Sum geometrical mutual L with current signs following each physical driver-to-receiver path.
// A branched/ambiguous path cannot be reduced this way; report it rather than choosing a route.
export function measureMutual(stages,laneA,laneB,indexA,indexB,frequencyHz) {
  const signs=new Map()
  for(const [lane,index] of [[laneA,indexA],[laneB,indexB]]) {
    const edges=stages.flatMap(s=>s.ports.map((p,i)=>({s:s.stage,i,...p}))).filter(p=>p.lane===lane)
    const remaining=new Set(edges)
    let node=`IN${index}`
    while(node!==`OUT${index}`) {
      const next=[...remaining].filter(p=>p.from===node||p.to===node)
      if(next.length!==1)throw new Error(`mutual_path_ambiguous: ${lane} at ${node} has ${next.length} continuations`)
      const p=next[0]
      remaining.delete(p)
      signs.set(`${p.s}:${p.i}`,p.from===node?1:-1)
      node=p.from===node?p.to:p.from
    }
    if(remaining.size)throw new Error(`mutual_path_disconnected: ${lane} has ${remaining.size} unvisited pieces`)
  }
  // The optional frequency includes the internal storage of the realized Foster network.
  let total=0
  for(const stage of stages)for(const [i,a] of stage.ports.entries())if(a.lane===laneA)for(const [j,b] of stage.ports.entries())if(b.lane===laneB) {
    const inductance=stage.L[i][j]+(frequencyHz===undefined?0:(stage.skin.terms??[stage.skin]).reduce((sum,term)=>sum+term.matrix[i][j]*fittedStorage(term.fit,frequencyHz),0))
    total+=inductance*signs.get(`${stage.stage}:${i}`)*signs.get(`${stage.stage}:${j}`)
  }
  return total
}
if(process.argv[1]?.endsWith('measure-mutual.mjs')) {
  const directory=process.argv[2]??'runs/2d/differential-data'
  const stages=[]
  for(const file of await readdir(directory))if(/^stage-\d+$/.test(file))stages.push(JSON.parse(await readFile(`${directory}/${file}/extraction.json`,'utf8')))
  const frequencyHz=stages[0]?.frequencyHz
  if(!Number.isFinite(frequencyHz)||frequencyHz<=0||stages.some(s=>s.frequencyHz!==frequencyHz))throw new Error('mutual_frequency: one finite common comparison frequency is required')
  const external=measureMutual(stages,'A','B',0,1)
  const realized=measureMutual(stages,'A','B',0,1,frequencyHz)
  console.log(JSON.stringify({signedExternalMutualL_H:external,signedRealizedMutualL_H:realized,frequencyHz,referenceH:4.2e-9,differencePercent:100*(realized/4.2e-9-1)},null,2))
}
