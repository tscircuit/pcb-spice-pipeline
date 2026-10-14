import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadEntry, runPipeline } from '../src/pipeline.mjs'
import { auditRun } from '../scripts/audit-eye.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const digest = text => createHash('sha256').update(text).digest('hex')

test('real routed board executes native IBIS/eye; element duration changes executed SPICE and folded eye; invalid probes fail', async () => {
  const stamp = Date.now(), output = join(root, 'runs', `real-board-integration-${stamp}`)
  const tools = JSON.parse(await readFile(process.env.PCB_SPICE_TOOLS ?? join(root, '.cache/tools/tools.json')))
  const variants = [
    ['short', { duration: '80ns' }],
    ['missing', { positive: '.U3 > .DOES_NOT_EXIST' }],
    ['mixed', { positive: '.U1 > .P1' }],
  ]
  const paths = {}
  try {
    await mkdir(output, { recursive: true })
    for (const [name, props] of variants) {
      paths[name] = join(output, `${name}.entry.mjs`)
      await writeFile(paths[name], `import { createBoard, modeling as originalModeling } from '../../examples/am3352-eye.tsx'\nexport const modeling = { ...originalModeling, circuit: '../../examples/' + originalModeling.circuit }\nexport default () => createBoard(${JSON.stringify(props)})\n`)
    }
    const baseline = await loadEntry(join(root, 'examples/am3352-eye.tsx'))
    assert.equal(baseline.eyeDiagrams.length, 1)
    assert.equal(baseline.eyeDiagrams[0].positiveSelector, '.U3 > .F3')
    assert.equal(baseline.eyeDiagrams[0].negativeSelector, '.U3 > .G3')
    const a = await runPipeline({ ...baseline, outputDir: join(output, '100ns'), tools })
    const auditA = await auditRun(join(output, '100ns'))
    const short = await loadEntry(paths.short)
    assert.equal(short.eyeDiagrams[0].durationSeconds, 80e-9, 'Changed actual native element rendered')
    const b = await runPipeline({ ...short, outputDir: join(output, '80ns'), tools })
    const auditB = await auditRun(join(output, '80ns'))
    const deckA = await readFile(join(output, '100ns/simulation.cir'), 'utf8')
    const deckB = await readFile(join(output, '80ns/simulation.cir'), 'utf8')
    assert.match(deckA, /^tran 1e-11 1e-7 0 1e-11$/m)
    assert.match(deckB, /^tran 1e-11 8e-8 0 1e-11$/m)
    assert.notEqual(digest(deckA), digest(deckB), 'Native duration changes actual solver instruction')
    const eyeA = await readFile(join(output, '100ns/eye-data.csv'))
    const eyeB = await readFile(join(output, '80ns/eye-data.csv'))
    assert.notEqual(digest(eyeA), digest(eyeB), 'Native duration changes actual folded eye data')
    assert.ok(auditB.foldedEyeWindows < auditA.foldedEyeWindows)
    assert.ok(Math.abs(a.metrics.simulatedDurationSeconds - 100e-9) < 1e-14)
    assert.ok(Math.abs(b.metrics.simulatedDurationSeconds - 80e-9) < 1e-14)
    await assert.rejects(loadEntry(paths.missing), /positive|selector|port/i, 'Missing native probe fails rendering')
    const mixed = await loadEntry(paths.mixed), invalidOutput = join(output, 'invalid-mixed')
    await assert.rejects(runPipeline({ ...mixed, outputDir: invalidOutput, tools: { fasthenry: '/missing', fastercap: '/missing', ngspice: '/missing' } }), /mixed endpoints|unsupported/)
    await assert.rejects(stat(invalidOutput), { code: 'ENOENT' }, 'Invalid endpoint fails before creating a solver run')
    await writeFile(join(output, 'integration-summary.json'), JSON.stringify({
      status: 'passed', output: resolve(output), nativeElementTimingChanged: true,
      changedDurationSeconds: [100e-9, 80e-9], actualTransientInstructions: [deckA.match(/^tran .+$/m)[0], deckB.match(/^tran .+$/m)[0]],
      foldedEyeWindows: [auditA.foldedEyeWindows, auditB.foldedEyeWindows],
      missingProbeFailsRendering: true, mixedEndpointFailsBeforeSolver: true,
      audits: [auditA, auditB],
    }, null, 2) + '\n')
  } finally {
    await Promise.all(Object.values(paths).map(path => rm(path, { force: true })))
  }
})
