import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Hosts such as the tscircuit CLI bundle the serializer. Its runtime graph must
// not reach React, which a bundling host may not be able to resolve.
test('the serialize entry is a React-free runtime graph', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const entry = new URL(`../${manifest.exports['./serialize'].import}`, import.meta.url)
  const seen = new Set(), bare = new Set(), pending = [entry]
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file.href)) continue
    seen.add(file.href)
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (specifier.startsWith('.')) pending.push(new URL(specifier, file))
      else bare.add(specifier)
    }
  }
  assert.ok(![...bare].some(specifier => specifier === 'react' || specifier.startsWith('react/')), [...bare].join(', '))
  const { serializeSimulation } = await import(entry.href)
  const { serializeSimulation: fromTsx, importedBoardRecords } = await import('../dist/tsx.js')
  assert.equal(serializeSimulation, fromTsx)
  assert.equal(importedBoardRecords, Symbol.for('pcb-spice-pipeline.imported-board.v2'))
})
