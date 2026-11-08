import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
export const json=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n')
export async function hashes(root,relative='',excludedRootNames=[]) {
  const out={}
  for(const name of (await readdir(join(root,relative))).sort()) {
    if((!relative&&excludedRootNames.includes(name))||name==='__pycache__'||name==='node_modules') continue
    const p=join(relative,name)
    const s=await stat(join(root,p))
    if(s.isDirectory()) Object.assign(out,await hashes(root,p,excludedRootNames))
    else if(p!=='receipt.json') out[p]=sha256(await readFile(join(root,p)))
  }
  return out
}
