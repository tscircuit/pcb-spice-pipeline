import React from 'react'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { renderCoreSignals } from '../tests/support/core-render'
import Board, { modeling } from '../tests/fixtures/layered-microstrip'
import { geometryFromCircuitJson } from '../src/board'
import { fasterCapDeck, parseFasterCap, referenceCapacitance } from '../src/extraction'
import { checkNativeRun } from '../src/extraction/parse'
import { createNativeSolver } from '../src/adapters'

const root = process.env.SI_RUN_ROOT ?? 'runs/layered-capacitance'
const native = createNativeSolver({ timeoutMs: Number(process.env.SI_NATIVE_TIMEOUT_MS ?? 180000), tools: { fastercap: '/opt/homebrew/bin/FasterCap' } })
const results = []
for (const coupled of [false, true]) {
  const circuit = await renderCoreSignals(<Board coupled={coupled} />)
  const settings = { ...modeling, lanes: modeling.lanes.slice(0, coupled ? 2 : 1) }
  const geometry = geometryFromCircuitJson(circuit, settings)
  const cell = geometry.cells[0]
  const original = fasterCapDeck(cell, settings.extraction)
  for (const refinement of (process.env.SI_INTERFACE_REFINEMENT ?? '0,1,2').split(',').map(Number)) {
    const files = { ...original }
    // Independent uniform subdivision isolates dielectric-interface resolution;
    // copper surfaces, geometry, solver options and acceptance criteria stay fixed.
    for (const file of Object.keys(files).filter(file => file.startsWith('dielectric-'))) {
      for (let step = 0; step < refinement; step++) files[file] = files[file].split('\n').flatMap(row => {
        if (!/^[TQ] /.test(row)) return [row]
        const [kind, name] = row.split(' ')
        const values = row.split(' ').slice(2).map(Number)
        const points = Array.from({ length: values.length / 3 }, (_, i) => values.slice(3 * i, 3 * i + 3))
        const triangles = kind === 'T' ? [points] : [[points[0], points[1], points[2]], [points[0], points[2], points[3]]]
        return triangles.flatMap(([a, b, c]) => {
          const ab = a.map((v, i) => (v + b[i]) / 2)
          const bc = b.map((v, i) => (v + c[i]) / 2)
          const ca = c.map((v, i) => (v + a[i]) / 2)
          return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].map(p => `T ${name} ${p.flat().join(' ')}`)
        })
      }).join('\n')
    }
    const dir = `${root}/${coupled ? 'coupled' : 'single'}-${refinement}`
    await mkdir(dir, { recursive: true })
    const request = { solver: 'fastercap' as const, args: ['channel.lst', '-b', '-a0.02', '-ap', '-e'], files, outputFiles: [] }
    await writeFile(`${dir}/request.json`, JSON.stringify(request, null, 2))
    const start = Date.now()
    const run = await native(request)
    await writeFile(`${dir}/stdout.log`, run.stdout)
    await writeFile(`${dir}/stderr.log`, run.stderr)
    checkNativeRun(run, dir, 'fastercap')
    const matrix = parseFasterCap(run.stdout).matrix.map(row => row.map(v => v * .001))
    const reciprocity = Math.max(...matrix.flatMap((row, i) => row.map((v, j) => Math.abs(v - matrix[j][i])))) / Math.max(...matrix.flat().map(Math.abs))
    const autoResidual = Number([...run.stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)?.[1])
    let rejection: string | undefined
    try {
      if (!Number.isFinite(autoResidual) || autoResidual < 0 || autoResidual > settings.extraction.capTolerance) throw new Error('FasterCap auto refinement did not meet the unchanged criterion')
      referenceCapacitance(matrix, settings.extraction.reciprocityTolerance)
    }
    catch (error) { rejection = (error as Error).message }
    const result = { accepted: !rejection, rejection, coupled, refinement, seconds: (Date.now() - start) / 1000, request_sha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
      matrix, reciprocity, grounded_diagonal_pf_per_m: matrix.slice(0, -1).map((row, i) => row[i] / cell.conductors[i].lengthM * 1e12),
      auto_residual: autoResidual,
      dielectric_panels: Object.entries(files).filter(([file]) => file.startsWith('dielectric-')).reduce((sum, [, text]) => sum + text.split('\n').filter(row => /^[TQ] /.test(row)).length, 0) }
    results.push(result)
    await writeFile(`${root}/summary.json`, JSON.stringify(results, null, 2) + '\n')
    console.log(JSON.stringify(result))
  }
}
