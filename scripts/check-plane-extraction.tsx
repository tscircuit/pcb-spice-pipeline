import React from 'react'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { renderCoreSignals } from '../tests/support/core-render'
import Board from '../tests/fixtures/escape-via-plane'
import { geometryFromCircuitJson } from '../src/board'
import { modeling } from '../tests/fixtures/native-channel'
import { extractChannel, fasterCapDeck, loopImpedance, parseFasterCap, referenceCapacitance } from '../src/extraction'
import { impedanceSamples } from '../src/extraction/parse'
import { createNativeSolver } from '../src/adapters'
import { rootScope } from '../src/kernel'
import type { SolverRequest, SolverResult } from '../src/solver'

const root = process.env.SI_RUN_ROOT ?? 'runs/plane-extraction'
await mkdir(root, { recursive: true })
const circuit = await renderCoreSignals(<Board />)
const settings = { ...modeling, viaPlatingMm: .018, viaEquivalentWidthMm: .236, relativePermittivity: 4.42,
  lanes: [{ port: 'DATA', from: { component: 'TX', port: 'Y' }, to: { component: 'RX', port: 'A' } }],
  extraction: { ...modeling.extraction, groundMeshMm: 1.43, maxPanelLengthMm: 2.86 } }
const geometry = geometryFromCircuitJson(circuit, settings)
await writeFile(`${root}/input.json`, JSON.stringify(circuit, null, 2))
await writeFile(`${root}/geometry.json`, JSON.stringify(geometry, null, 2))
const native = createNativeSolver({ timeoutMs: 180000, tools: { fasthenry: '/opt/homebrew/bin/fasthenry', fastercap: '/opt/homebrew/bin/FasterCap' } })
const cache = new Map<string, { result: SolverResult; directory: string }>()
/** Digest exact solver inputs, including every deck byte. */
const digest = (request: SolverRequest): string => createHash('sha256').update(JSON.stringify(request)).digest('hex')
if (process.env.SI_EXTRACTION_CACHE) for (const entry of await readdir(process.env.SI_EXTRACTION_CACHE)) {
  if (!/^native-\d+-fasthenry$/.test(entry)) continue
  const directory = `${process.env.SI_EXTRACTION_CACHE}/${entry}`
  const request = JSON.parse(await readFile(`${directory}/request.json`, 'utf8')) as SolverRequest
  const files = Object.fromEntries(await Promise.all(request.outputFiles.map(async file => [file, await readFile(`${directory}/${file}`, 'utf8')])))
  cache.set(digest(request), { directory, result: { files, stdout: await readFile(`${directory}/stdout.log`, 'utf8'), stderr: await readFile(`${directory}/stderr.log`, 'utf8') } })
}
const calls: { solver: string; request_sha256: string; exact_native_extraction_replay_from?: string }[] = []
const outputs: SolverResult[] = []
/** Archive each bounded native call; extraction replay requires an exact request hash. */
const run = async (request: SolverRequest): Promise<SolverResult> => {
  const directory = `${root}/native-${calls.length}-${request.solver}`
  const cached = cache.get(digest(request))
  calls.push({ solver: request.solver, request_sha256: digest(request), ...(cached ? { exact_native_extraction_replay_from: cached.directory } : {}) })
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/request.json`, JSON.stringify(request, null, 2))
  const result = cached?.result ?? await native(request)
  for (const [file, body] of Object.entries({ ...result.files, 'stdout.log': result.stdout, 'stderr.log': result.stderr })) await writeFile(`${directory}/${file}`, body)
  outputs.push(result)
  return result
}
let rejection: string | undefined
try {
  await extractChannel(geometry, settings, rootScope('extraction'), { progress: console.log, runSolver: run })
} catch (error) {
  if ((error as { code?: string }).code !== 'mesh_convergence') throw error
  rejection = (error as Error).message
}
// A rejected mesh stays rejected. One separate capacitance diagnostic supplies a
// plausibility comparison, never a channel accepted for transient/eye evidence.
const cell = geometry.cells[0]
const cap = await run({ solver: 'fastercap', args: ['channel.lst', '-b', '-a0.02', '-ap', '-e'], files: fasterCapDeck(cell, settings.extraction), outputFiles: [] })
const C = referenceCapacitance(parseFasterCap(cap.stdout).matrix.map(row => row.map(value => value * 1e-3))).matrix
const refined = impedanceSamples(outputs[1].files['Zc.mat'], cell)[0]
const L = loopImpedance(refined.L)
const length = cell.conductors[0].lengthM
const u = .15 / 1.43
const er = 4.42
// Hammerstad/Jensen, zero-thickness approximation, Qucs technical equations 11.4–11.18.
const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + .432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7
const b = .564 * ((er - .9) / (er + 3)) ** .053
const effectiveEr = (er + 1) / 2 + (er - 1) / 2 * (1 + 10 / u) ** (-a * b)
const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / u) ** .7528))
const airImpedance = 376.730313668 / (2 * Math.PI) * Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2))
const summary = { status: rejection ? 'unconverged_native_diagnostic' : 'verified_native_extraction_only', fixture: 'escape-via-plane.tsx; not an RFC example', rejection,
  native_calls: calls, length_m: length, L_h_per_m: L[0][0] / length, C_f_per_m: C[0][0] / length,
  capacitance_auto_residual: Number([...cap.stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)?.[1]),
  estimate: { source: 'https://qucs.sourceforge.net/tech/node75.html', width_mm: .15, dielectric_height_mm: 1.43, copper_thickness_mm: .03, er,
    approximation: 'zero-thickness infinite plane; excludes finite board, end contacts, bends, via and internal inductance', effective_er: effectiveEr,
    impedance_ohm: airImpedance / Math.sqrt(effectiveEr), L_h_per_m: airImpedance / 299792458, C_f_per_m: effectiveEr / (airImpedance * 299792458),
    homogeneous_C_f_per_m: er / (airImpedance * 299792458) } }
await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary))
