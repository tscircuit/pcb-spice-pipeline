import React from 'react'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { renderSignals } from '../tests/support/signal-render'
import { runPipeline } from '../src'
import { createNativeSolver } from '../src/adapters'
import Single from '../examples/levels/level1-single-ended'
import Differential from '../examples/levels/level1-differential'
import Three from '../examples/levels/level3-three-signals'
const modelDir = process.env.IBIS_MODEL_DIR ?? 'models'
const ibisSources = Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${modelDir}/${file}`)])))
const selected = process.argv[2]
for (const [name, Board] of Object.entries({ single: Single, differential: Differential, three: Three })) {
  if (selected && selected !== name) continue
  const started = Date.now()
  const circuitJson = await renderSignals(<Board />)
  await mkdir(`runs/levels/${name}`, { recursive: true })
  await writeFile(`runs/levels/${name}/input.json`, JSON.stringify(circuitJson, null, 2))
  const native = createNativeSolver({ timeoutMs: 600000, tools: { fasthenry: '/opt/homebrew/bin/fasthenry', fastercap: '/opt/homebrew/bin/FasterCap', ngspice: '/opt/homebrew/bin/ngspice' } })
  let calls = 0
  const result = await runPipeline({ circuitJson, ibisSources, runSolver: async request => {
    const dir = `runs/levels/${name}/native-${calls++}-${request.solver}`
    await mkdir(dir, { recursive: true })
    for (const [file, body] of Object.entries(request.files)) await writeFile(`${dir}/${file}`, body)
    const output = await native(request)
    await writeFile(`${dir}/stdout.log`, output.stdout)
    await writeFile(`${dir}/stderr.log`, output.stderr)
    for (const [file, body] of Object.entries(output.files)) await writeFile(`${dir}/${file}`, body)
    return output
  }, onProgress: console.log })
  const summary = { name, seconds: (Date.now() - started) / 1000, sources: Object.fromEntries(Object.entries(ibisSources).map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')])),
    native_execution: JSON.parse(result.files['native-execution.json']),
    transient_convergence: Object.fromEntries(Object.entries(result.files).filter(([file]) => file.endsWith('numerical-convergence.json')).map(([file, body]) => [file, JSON.parse(body)])),
    blocks: result.blocks.map(block => ({ name: block.name, numericalSettings: block.numericalSettings, results: block.results.filter(r => !['simulation_signal_waveform'].includes(r.type)).map(r => r.type === 'simulation_signal_eye' ? { ...r, folded_traces: undefined } : r), limitations: block.limitations })) }
  await writeFile(`runs/levels/${name}/summary.json`, JSON.stringify(summary, null, 2))
  for (const [file, body] of Object.entries(result.files)) {
    await mkdir(`runs/levels/${name}/${dirname(file)}`, { recursive: true })
    await writeFile(`runs/levels/${name}/${file}`, body)
  }
  console.log(JSON.stringify(summary))
}
