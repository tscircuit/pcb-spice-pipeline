// BEFORE only. Run on si-2d/repro. Native 3D is never a fallback for the new path.
import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { geometryFromCircuitJson } from '../src/board/index'
import { extractChannel } from '../src/extraction/index'
import { rootScope } from '../src/kernel/index'
import { createNativeSolver } from '../src/adapters/index'
const solver = createNativeSolver({timeoutMs:2147483647,tools:{fasthenry:'/opt/homebrew/bin/fasthenry',fastercap:'/opt/homebrew/bin/FasterCap',ngspice:'/opt/homebrew/bin/ngspice'}})
await mkdir('runs/2d-baseline',{recursive:true})
for (const name of ['single-ended','differential-data']) {
  const {circuitJson,modeling}=await import(`../examples/${name}/index.circuit.tsx`)
  const geometry=geometryFromCircuitJson(circuitJson,modeling)
  const start=performance.now()
  const data={name,commit:'8a05494',geometry:geometry.approximations}
  try {
    const result=await extractChannel(geometry,modeling,rootScope('extraction'),{runSolver:solver,progress:console.log})
    data.matrices=result.value.matrices
    for (const artifact of result.artifacts) {
      const path=`runs/2d-baseline/${name}/${artifact.path}`
      await mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true})
      await writeFile(path,artifact.body)
    }
  } catch(error) {data.error={code:error.code,message:error.message}}
  data.extractionSeconds=(performance.now()-start)/1000
  await writeFile(`runs/2d-baseline/${name}.json`,JSON.stringify(data,null,2))
  console.log(name,data.extractionSeconds,data.error??'ok')
}
