import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {CircuitJson} from './schema.js'
import type {PipelineResult} from './general-pipeline.js'
import type {RunSolver, Solver} from './solver.js'
import {relativeFile, type IbisSources} from './model-source.js'
import {generateReport} from './index.js'
import {fail} from './matrices.mjs'

export interface NativeSolverOptions {
  tools?: Partial<Record<Solver,string>>
  timeoutMs?: number
}
const exec=promisify(execFile)
const contained=(root: string,path: string): string=>{
  const location=relative(root,path)
  if(location.split(/[\\/]/).includes('..')||isAbsolute(location))
    fail('file_path',`File must remain inside ${root}`)
  return path
}

/** Executes only requests passed by the caller; never installs or downloads tools. */
export function createNativeSolver({tools={},timeoutMs=900000}: NativeSolverOptions={}): RunSolver {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0) fail('native_timeout','timeoutMs must be a positive integer')
  return async request=>{
    if(!['fasthenry','fastercap','ngspice'].includes(request.solver)) fail('native_solver','Unknown solver')
    for(const path of [...Object.keys(request.files),...request.outputFiles]) relativeFile(path)
    const directory=await mkdtemp(join(tmpdir(),'pcb-spice-'))
    try {
      for(const [path,body] of Object.entries(request.files)) {
        const target=join(directory,path)
        await mkdir(dirname(target),{recursive:true})
        await writeFile(target,body)
      }
      let run: {stdout:string;stderr:string}
      try {
        run=await exec(tools[request.solver]??(request.solver==='fastercap'?'FasterCap':request.solver),request.args,
          {cwd:directory,timeout:timeoutMs,maxBuffer:64*1024*1024,env:{...process.env,OMP_NUM_THREADS:'1'}})
      } catch(error) {
        const detail=error as Error & {code?: string|number|null;killed?: boolean;signal?: string;stdout?: string;stderr?: string}
        // execFile's timeout kills with SIGTERM and no exit code. External
        // signals are not marked killed; maxBuffer errors have a string code.
        const timedOut=detail.killed&&detail.signal==='SIGTERM'&&detail.code===null
        fail(timedOut?'native_timeout':'native_solver',`${request.solver}: ${timedOut?`exceeded ${timeoutMs} ms process timeout; ${detail.message}`:detail.message}\n${detail.stdout??''}\n${detail.stderr??''}`)
      }
      const files: Record<string,string>=Object.create(null)
      const root=await realpath(directory)
      for(const path of request.outputFiles) {
        try {files[path]=await readFile(contained(root,await realpath(join(directory,path))),'utf8')}
        catch(error) {
          if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error
          // The pipeline validates required outputs and solver diagnostics.
        }
      }
      return {...run,files}
    } finally {await rm(directory,{recursive:true,force:true})}
  }
}

/** Load declared local files only. Asset URLs do not trigger downloads. */
export async function loadIbisSources({circuitJson,baseDir}: {circuitJson:CircuitJson;baseDir:string}): Promise<IbisSources> {
  const root=await realpath(baseDir),sources: IbisSources=Object.create(null)
  for(const record of circuitJson) if(record.type==='simulation_ibis_model') {
    const path=relativeFile(record.ibis_model_asset.project_relative_path)
    if(!Object.hasOwn(sources,path)) sources[path]=await readFile(contained(root,await realpath(resolve(root,path))))
  }
  return sources
}

/** Write the supplied result and a report at the caller's explicit request. */
export async function writePipelineOutput({result,outputDir}: {result:PipelineResult;outputDir:string}): Promise<void> {
  const files={...result.files,...generateReport(result)}
  for(const path of Object.keys(files)) relativeFile(path)
  await mkdir(outputDir,{recursive:true})
  const root=await realpath(outputDir)
  for(const [path,body] of Object.entries(files)) {
    const target=resolve(root,path)
    await mkdir(dirname(target),{recursive:true})
    contained(root,await realpath(dirname(target)))
    try {contained(root,await realpath(target))} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error}
    await writeFile(target,body)
  }
}
