// Rebuild the checked-in IEEE-double LU kernel. Requires clang and wasm-ld (LLVM/lld).
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const temporary=mkdtempSync(join(tmpdir(),'si-lu-build-'))
try {
  const output=join(temporary,'lu.wasm')
  execFileSync(process.env.CLANG??'clang',['--target=wasm32','-O3','-msimd128','-ffp-contract=off','-nostdlib',
    ...(process.env.WASM_LD?['-fuse-ld='+process.env.WASM_LD]:[]),'-Wl,--no-entry','-Wl,--import-memory','-Wl,--export=lu','-Wl,--export=__heap_base','src/extraction/lu.c','-o',output],{stdio:'inherit'})
  const file='src/extraction/lu.ts'
  const source=readFileSync(file,'utf8').replace(/atob\('[A-Za-z0-9+/=]+'\)/,`atob('${readFileSync(output).toString('base64')}')`)
  writeFileSync(file,source)
} finally {rmSync(temporary,{recursive:true,force:true})}
