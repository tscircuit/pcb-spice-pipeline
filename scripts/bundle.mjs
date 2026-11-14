import {build} from 'esbuild'
import {writeFile} from 'node:fs/promises'

// The converter's umbrella entry also exports an archive loader. Bundle and
// tree-shake its browser graph so importing our pure entry never initializes
// fflate's Node worker bridge or any other optional host capability.
await build({entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,
  platform:'browser',format:'esm',target:'es2023',
  mainFields:['module','main'],define:{process:'undefined'},
  external:['circuit-json','zod'],
})
// The "./node" export is dist/adapters/index.js. Keep the historical dist/node.js path working for
// consumers that import the file directly.
await writeFile('dist/node.js',"export * from './adapters/index.js'\n")
await writeFile('dist/node.d.ts',"export * from './adapters/index.js'\n")
