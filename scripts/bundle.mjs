import {build} from 'esbuild'
import {rm,readFile,writeFile} from 'node:fs/promises'

// The converter's umbrella entry also exports an archive loader. Bundle and
// tree-shake its browser graph so importing our pure entry never initializes
// fflate's Node worker bridge or any other optional host capability.
await build({entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,
  platform:'browser',format:'esm',target:'es2023',
  mainFields:['module','main'],define:{process:'undefined'},
  external:['circuit-json','zod','earcut'],
})
// Historical audit helpers are source-only and are not part of the library.
await rm('dist/legacy',{recursive:true,force:true})
// Retain the bundled clipping dependency's copyright and license notice.
await writeFile('dist/clipper2-LICENSE.txt','Clipper2: Copyright Angus Johnson 2010-2025. TypeScript port: Jeremy Tribby.\n\n'+await readFile('node_modules/clipper2-ts/LICENSE','utf8'))
