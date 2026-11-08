import {readFile,readdir} from 'node:fs/promises'
// Sum geometrical mutual L with current signs following each physical driver-to-receiver path.
// A branched/ambiguous path cannot be reduced this way; report it rather than choosing a route.
export function measureMutual(stages,laneA,laneB,indexA,indexB) {
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
  return stages.reduce((sum,s)=>sum+s.ports.reduce((a,p,i)=>a+s.ports.reduce((b,q,j)=>b+(p.lane===laneA&&q.lane===laneB?s.L[i][j]*signs.get(`${s.stage}:${i}`)*signs.get(`${s.stage}:${j}`):0),0),0),0)
}
if(process.argv[1]?.endsWith('measure-mutual.mjs')) {
  const directory=process.argv[2]??'runs/2d/differential-data'
  const stages=[]
  for(const file of await readdir(directory))if(/^stage-\d+$/.test(file))stages.push(JSON.parse(await readFile(`${directory}/${file}/extraction.json`,'utf8')))
  const value=measureMutual(stages,'A','B',0,1)
  console.log(JSON.stringify({signedExternalMutualL_H:value,referenceH:4.2e-9,differencePercent:100*(value/4.2e-9-1)},null,2))
}
