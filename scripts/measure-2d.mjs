import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { runPipeline } from '../src/index'
import { createNativeSolver, loadIbisSources, writePipelineOutput } from '../src/adapters/index'
const native = createNativeSolver({ tools: { ngspice: '/opt/homebrew/bin/ngspice' } })
const names = process.argv.slice(2)
for (const name of names.length ? names : ['single-ended', 'differential-data', 'crosstalk', 'multilayer']) {
  const { circuitJson, modeling } = await import(`../examples/${name}/index.circuit.tsx`)
  const ibisSources = await loadIbisSources({ circuitJson, baseDir: 'runs/2d-models' })
  const started = performance.now()
  let extractionStart
  let extractionEnd
  let nativeSeconds = 0
  const result = await runPipeline({ circuitJson, modeling, ibisSources,
    onProgress: message => { console.log(message)
      if (message.startsWith('Segment ') && extractionStart === undefined) extractionStart = performance.now()
    },
    runSolver: async request => {
      if (request.solver !== 'ngspice') throw new Error('3D extraction is forbidden')
      extractionEnd = performance.now()
      const start = performance.now()
      await mkdir(`runs/2d-requests/${name}`,{recursive:true})
      for (const [file, body] of Object.entries(request.files)) await writeFile(`runs/2d-requests/${name}/${file}`,body)
      const output = await native(request)
      await writeFile(`runs/2d-requests/${name}/stdout.log`,output.stdout)
      await writeFile(`runs/2d-requests/${name}/stderr.log`,output.stderr)
      nativeSeconds += (performance.now() - start) / 1000
      return output
    },
  })
  await writePipelineOutput({ result, outputDir: `runs/2d/${name}` })
  const summary = { name, totalSeconds: (performance.now() - started) / 1000,
    extractionSeconds: (extractionEnd - extractionStart) / 1000, nativeSeconds,
    segments: result.matrices.length, uniqueSlices: new Set(result.matrices.map(m => m.sliceHash)).size,
    cells: result.matrices.reduce((s, m) => s + m.cells, 0),
    mutualL: result.matrices.reduce((s, m) => s + (m.ports.length > 1 ? m.L[0][1] : 0), 0),
    eyes: result.experiments.flatMap(e => e.eyes.map(eye => ({name: eye.name, metrics: eye.metrics}))),
  }
  await writeFile(`runs/2d/${name}/summary.json`, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}
