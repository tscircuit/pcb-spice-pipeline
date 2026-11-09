import React from 'react'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { renderCoreSignals } from '../tests/support/core-render'
import Board, { modeling } from '../tests/fixtures/layered-microstrip'
import Single from '../examples/levels/level1-single-ended'
import Differential from '../examples/levels/level1-differential'
import Two from '../examples/levels/level2-two-signals'
import { prepareBlocks } from '../src/pipeline/signals'
import { geometryFromCircuitJson } from '../src/board'
import { fasterCapDeck, parseFasterCap, validateMatrix } from '../src/extraction'
import { checkNativeRun } from '../src/extraction/parse'

const root = process.env.SI_RUN_ROOT ?? 'runs/full-plane-capacitance'
const timeoutMs = 600000
const exec = promisify(execFile)
const automatic = ['-a0.02', '-ap']
const variants: Record<string, { maximum?: number; edge?: number; planeEdges?: boolean; args?: string[]; air?: boolean }> = {
  baseline: {},
  'uniform-0715': { maximum: .715 },
  'uniform-03575': { maximum: .3575 },
  'uniform-017875': { maximum: .17875 },
  'edge-003': { edge: .03 },
  'plane-edge-0075': { edge: .075, planeEdges: true },
  'plane-edge-003': { edge: .03, planeEdges: true },
  'accuracy-0005': { args: ['-a0.005', '-ap'] },
  'accuracy-0001': { args: ['-a0.001', '-ap'] },
  galerkin: { args: [...automatic, '-g'] },
  'direct-001': { args: [...automatic, '-d0.01'] },
  'manual-0001': { args: ['-m0.0001', '-t0.00001', '-d0.1', '-ps128'] },
  'manual-00005': { args: ['-m0.00005', '-t0.00001', '-d0.1', '-ps128'] },
  air: { air: true, args: [...automatic, '-c'] },
  'air-uniform-017875': { air: true, maximum: .17875 },
}

/** Bisect longest edges while preserving winding; refine the entire plane and dielectric perimeter. */
function refineEdges(text: string, bounds: number[], minimum: number, edges: number[][][] = []): string {
  const [x0, x1, y0, y1] = bounds
  const rows: string[] = []
  /** Recursively split a triangle to the distance-graded perimeter size, capped everywhere at 0.715 mm. */
  const visit = (name: string, points: number[][]): void => {
    const center = [0, 1, 2].map(i => points.reduce((sum, p) => sum + p[i], 0) / 3)
    const boardDistance = Math.max(0, Math.min(center[0] - x0, x1 - center[0], center[1] - y0, y1 - center[1]))
    const distance = Math.min(boardDistance, ...edges.map(([a, b]) => {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(center[0] - a[0] - t * dx, center[1] - a[1] - t * dy)
    }))
    const target = Math.min(.715, minimum + .5 * distance)
    const lengths = points.map((a, i) => Math.hypot(...a.map((v, j) => v - points[(i + 1) % 3][j])))
    const index = lengths.indexOf(Math.max(...lengths))
    if (lengths[index] <= target) {
      rows.push(`T ${name} ${points.flat().join(' ')}`)
      return
    }
    const a = points[index]
    const b = points[(index + 1) % 3]
    const c = points[(index + 2) % 3]
    const middle = a.map((v, i) => (v + b[i]) / 2)
    visit(name, [a, middle, c])
    visit(name, [middle, b, c])
  }
  for (const row of text.split('\n')) {
    if (!/^[TQ] /.test(row)) {
      rows.push(row)
      continue
    }
    const [kind, name, ...values] = row.split(' ')
    const numbers = values.map(Number)
    const points = Array.from({ length: numbers.length / 3 }, (_, i) => numbers.slice(i * 3, i * 3 + 3))
    visit(name, points.slice(0, 3))
    if (kind === 'Q') visit(name, [points[0], points[2], points[3]])
  }
  return rows.join('\n')
}

const name = process.argv[2] ?? 'fixture'
const boards = { fixture: Board, single: Single, differential: Differential, two: Two }
if (!(name in boards)) throw new Error(`Unknown board ${name}`)
const circuit = await renderCoreSignals(React.createElement(boards[name as keyof typeof boards]))
const sources = name === 'fixture' ? {} : Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)])))
const prepared = name === 'fixture' ? undefined : prepareBlocks(circuit, sources)[0]
const settings = prepared?.settings ?? { ...modeling, lanes: modeling.lanes.slice(0, 1) }
const cell = geometryFromCircuitJson(prepared?.circuit ?? circuit, settings).cells[0]
const source = name === 'fixture' ? 'tests/fixtures/layered-microstrip.tsx' : `examples/levels/${({ single: 'level1-single-ended', differential: 'level1-differential', two: 'level2-two-signals' })[name]}.tsx`
const polygon = cell.dielectric!.polygon[0]
const bounds = [Math.min(...polygon.map(p => p[0])), Math.max(...polygon.map(p => p[0])), Math.min(...polygon.map(p => p[1])), Math.max(...polygon.map(p => p[1]))]
const planeEdges = cell.routedCopper!.pours.flatMap(pour => pour.polygon.flatMap(ring => ring.flatMap((point, i) => {
  const next = ring[(i + 1) % ring.length]
  return Math.hypot(point[0] - next[0], point[1] - next[1]) ? [[point, next]] : []
})))
const results: unknown[] = []
await mkdir(root, { recursive: true })
await writeFile(`${root}/provenance.json`, JSON.stringify({
  fixture: source,
  fixture_sha256: createHash('sha256').update(await readFile(source)).digest('hex'),
  binary_sha256: createHash('sha256').update(await readFile('/opt/homebrew/bin/FasterCap')).digest('hex'),
  core_sha256: createHash('sha256').update(await readFile(process.env.SI_CORE_MODULE!)).digest('hex'),
  timeout_ms: timeoutMs, reciprocity_tolerance: settings.extraction.reciprocityTolerance, cap_tolerance: settings.extraction.capTolerance,
  analytic_pf_per_m: 37.565933, analytic: 'Hammerstad/Jensen, zero thickness, infinite plane',
}, null, 2) + '\n')
for (const variant of (process.env.SI_CAP_VARIANTS ?? 'baseline,uniform-0715,uniform-03575,uniform-017875,edge-003,accuracy-0005,galerkin,direct-001').split(',')) {
  const choice = variants[variant]
  if (!choice) throw new Error(`Unknown variant ${variant}`)
  const files = fasterCapDeck(cell, { ...settings.extraction, maxPanelLengthMm: choice.maximum ?? settings.extraction.maxPanelLengthMm })
  if (choice.edge) for (const file of Object.keys(files).filter(file => /^(return|dielectric-)/.test(file))) files[file] = refineEdges(files[file], bounds, choice.edge, choice.planeEdges ? planeEdges : [])
  if (choice.air) {
    files['channel.lst'] = files['channel.lst'].split('\n').filter(row => !row.startsWith('D ')).map(row => row.startsWith('C ') ? row.replace(/^(C \S+) \S+/, '$1 1') : row).join('\n')
    for (const file of Object.keys(files).filter(file => file.startsWith('dielectric-'))) delete files[file]
  }
  const panels = Object.fromEntries(['sig', 'return', 'dielectric-'].map(prefix => [prefix, Object.entries(files).filter(([file]) => file.startsWith(prefix)).reduce((sum, [, text]) => sum + text.split('\n').filter(row => /^[TQ] /.test(row)).length, 0)]))
  const request = { solver: 'fastercap', args: ['channel.lst', '-b', ...(choice.args ?? automatic), '-e', '-i'], files, outputFiles: [] }
  const directory = resolve(root, variant)
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/request.json`, JSON.stringify(request, null, 2))
  for (const [name, text] of Object.entries(files)) await writeFile(`${directory}/${name}`, text)
  console.log(JSON.stringify({ variant, state: 'started', panels, args: request.args }))
  const start = Date.now()
  let stdout = ''
  let stderr = ''
  let error: string | undefined
  let code: string | number | null | undefined
  try {
    const run = await exec('/opt/homebrew/bin/FasterCap', request.args, { cwd: directory, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: '1' } })
    stdout = run.stdout
    stderr = run.stderr
    checkNativeRun(run, directory, 'fastercap')
  } catch (failure) {
    const detail = failure as Error & { stdout?: string; stderr?: string; code?: string | number | null; killed?: boolean }
    stdout = detail.stdout ?? stdout
    stderr = detail.stderr ?? stderr
    error = detail.message
    code = detail.killed ? 'native_timeout' : detail.code
  }
  const seconds = (Date.now() - start) / 1000
  await writeFile(`${directory}/stdout.log`, stdout)
  await writeFile(`${directory}/stderr.log`, stderr)
  let measurements = {}
  if (!error) {
    const matrix = parseFasterCap(stdout).matrix.map(row => row.map(value => value * .001))
    const reciprocity = Math.max(...matrix.flatMap((row, i) => row.map((value, j) => Math.abs(value - matrix[j][i])))) / Math.max(...matrix.flat().map(Math.abs))
    const residual = [...stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)?.[1]
    const autoResidual = residual === undefined ? null : Number(residual)
    let rejection: string | undefined
    try {
      validateMatrix(matrix, 'C primitive', settings.extraction.reciprocityTolerance)
      if (autoResidual === null || autoResidual < 0 || autoResidual > settings.extraction.capTolerance) throw new Error('No qualifying automatic refinement residual')
      if (choice.air) throw new Error('All-air control is a different physical problem')
    } catch (failure) { rejection = (failure as Error).message }
    const rawC = matrix[0][0] / cell.conductors[0].lengthM * 1e12
    measurements = { matrix, reciprocity, auto_residual: autoResidual, accepted: !rejection, rejection,
      grounded_diagonal_pf_per_m: rawC, analytic_relative_difference: rawC / 37.565933 - 1,
      refined_panels: Number([...stdout.matchAll(/Number of panels after refinement:\s*(\d+)/g)].at(-1)?.[1]) || null }
  }
  const result = { variant, seconds, panels, total_input_panels: Object.values(panels).reduce((a, b) => a + b, 0), request_sha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    last_reported_refined_panels: Number([...stdout.matchAll(/Number of panels after refinement:\s*(\d+)/g)].at(-1)?.[1]) || null,
    ...measurements, ...(error ? { accepted: false, code, error: error.slice(0, 1000) } : {}) }
  results.push(result)
  await writeFile(`${root}/summary.json`, JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
