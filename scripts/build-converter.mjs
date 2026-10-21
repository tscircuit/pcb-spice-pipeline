// The pinned upstream GitHub package currently ships source without a prepare
// script. Build that installed dependency locally; never copy a vendored tarball.
import { access, mkdir, realpath, readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const entry = fileURLToPath(import.meta.resolve('@tscircuit/ibis-to-spice'))
const root = await realpath(dirname(dirname(entry)))
const exists = async path => access(path).then(() => true, () => false)
if (!await exists(entry)) {
  const source = join(root, 'lib/index.ts')
  await access(source)
  await mkdir(dirname(entry), { recursive: true })
  for (const name of ['index', 'cli']) await build({ entryPoints: [join(root, `lib/${name}.ts`)], outfile: join(root, `dist/${name}.js`), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' })
}
if (!await exists(join(root, 'dist/general.d.ts'))) {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), ...(await readdir(join(root, 'lib'))).filter(name => name.endsWith('.ts')).map(name => join(root, 'lib', name)),
    '--declaration', '--emitDeclarationOnly', '--outDir', join(root, 'dist'),
    '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler',
    '--strict', '--skipLibCheck', '--types', 'node'], { stdio: 'inherit' })
}

// Generated declarations also work for NodeNext consumers.
for (const name of (await readdir(join(root, 'dist'))).filter(name => name.endsWith('.d.ts'))) {
  const path = join(root, 'dist', name), original = await readFile(path, 'utf8')
  const portable = original.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (all, before, specifier, after) =>
    /\.[cm]?js$/.test(specifier) ? all : `${before}${specifier}.js${after}`)
  if (portable !== original) await writeFile(path, portable)
}
