import {build} from 'esbuild'

// The converter's umbrella entry also exports an archive loader. Bundle and
// tree-shake its browser graph so importing our pure entry never initializes
// fflate's Node worker bridge or any other optional host capability.
await build({entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,
  platform:'browser',format:'esm',target:'es2023',
  mainFields:['module','main'],define:{process:'undefined'},
  external:['circuit-json','zod','earcut'],
})
