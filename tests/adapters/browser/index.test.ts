import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import * as browser from '../../../src/adapters/browser'

test('browser entry exposes only the worker adapter and imports no Node capabilities', async () => {
  assert.deepEqual(Object.keys(browser), ['createWasmSolver'])
  const result = await build({ entryPoints: ['src/adapters/browser/index.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true })
  assert.ok(result.outputFiles[0].text.includes('new Worker'))
  assert.ok(Object.keys(result.metafile!.inputs).every(path => !path.includes('native-solver')))
})
