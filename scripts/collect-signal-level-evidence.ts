import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { prepareBlocks } from '../src/pipeline/signals'
import { geometryFromCircuitJson } from '../src/board'
import { impedanceSamples } from '../src/extraction/parse'
import { loopImpedance, parseFasterCap, referenceCapacitance } from '../src/extraction'
import type { Matrix } from '../src/extraction'

const output = 'tests/evidence/signal-levels'
const binaries = Object.fromEntries(await Promise.all(['fasthenry', 'FasterCap', 'ngspice'].map(async name => [name, createHash('sha256').update(await readFile(`/opt/homebrew/bin/${name}`)).digest('hex')])))
const sources = Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)])))
const runs = [
  ['level1-single-ended', undefined, 'runs/cap-review-final/single'],
  ['level1-differential', undefined, 'runs/cap-review-final/differential'],
  ['level2-two-signals', undefined, 'runs/cap-review-final/two'],
  ['level3-three-signals', 'TRAFFIC', 'runs/layered-rfc-v3-traffic/three'],
  ['level3-three-signals', 'XTALK_LOW', 'runs/layered-rfc-v3-low/three'],
  ['level3-three-signals', 'XTALK_HIGH', 'runs/layered-rfc-v3-high/three'],
] as const
/** Exact byte digest, including native decks and source files. */
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
/** Same maximum full-matrix relative change used by extraction, with no threshold alteration. */
const delta = (a: Matrix, b: Matrix): number => Math.max(...b.flatMap((row, i) => row.map((v, j) => Math.abs(v - a[i][j])))) / Math.max(...b.flat().map(Math.abs))
const cases: any[] = []
for (const [example, block, directory] of runs) {
  const summary = JSON.parse(await readFile(`${directory}/summary.json`, 'utf8'))
  const input = await readFile(`${directory}/input.json`, 'utf8')
  const circuit = JSON.parse(input)
  const prepared = prepareBlocks(circuit, sources)[0]
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  const cell = geometry.cells[0]
  const calls = summary.native_requests ?? summary.native_execution
  let coarse: any
  let refined: any
  let primitiveC: Matrix | undefined
  let capResidual: number | undefined
  for (const [i, request] of calls.entries()) {
    try {
      if (request.solver === 'fasthenry') {
        const samples = impedanceSamples(await readFile(`${directory}/native-${i}-fasthenry/Zc.mat`, 'utf8'), cell)
        const model = samples.find(sample => Math.abs(sample.frequencyHz / prepared.settings.extraction.modelHz - 1) < 1e-8)
        if (i === 0) coarse = model
        else refined = model
      } else if (request.solver === 'fastercap') {
        const stdout = await readFile(`${directory}/native-${i}-fastercap/stdout.log`, 'utf8')
        primitiveC = parseFasterCap(stdout).matrix.map(row => row.map(value => value * 1e-3))
        capResidual = Number([...stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)?.[1])
      }
    } catch { /* Missing native output is unavailable, never zero. */ }
  }
  const selected = refined ?? coarse
  const L = selected ? loopImpedance(selected.L) : null
  const R = selected ? loopImpedance(selected.R) : null
  const C = primitiveC && summary.status === 'verified_native' ? referenceCapacitance(primitiveC).matrix : null
  const shared = block?.startsWith('XTALK') ? cases.find(item => item.block === 'TRAFFIC') : undefined
  if (shared && calls[1].request_sha256 !== shared.native_execution[1].request_sha256) throw new Error('Quiet extraction is not byte-identical to TRAFFIC')
  const item = { ...summary, example, block, error: summary.error?.split('\n\n')[0],
    ...(shared ? { status: 'blocked_by_shared_extraction', error: shared.error, blocked_by_request_sha256: calls[1].request_sha256,
      quiet_native_attempt: 'coarse native output replayed; identical refinement attempt cancelled after the TRAFFIC refinement reached its 600000 ms deadline',
      interrupted_quiet_error: summary.error.split('\n\n')[0] } : {}),
    accepted: summary.status === 'verified_native', input_sha256: digest(input),
    physical_records: Object.fromEntries(['pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuit.filter((r: any) => r.type === type).length])),
    numerical_settings: prepared.settings,
    extraction: { R_ohm: R, L_h: L, C_f: C, primitive_C_f: primitiveC ?? null,
      selected_R_L: refined ? 'refined' : coarse ? 'coarse_only_unaccepted' : 'unavailable',
      R_mesh_delta: refined && coarse ? delta(loopImpedance(coarse.R), loopImpedance(refined.R)) : null,
      L_mesh_delta: refined && coarse ? delta(loopImpedance(coarse.L), loopImpedance(refined.L)) : null,
      cap_auto_residual: capResidual ?? null, channel_accepted: summary.status === 'verified_native',
      per_length: cell.conductors.slice(0, -1).map((conductor, i) => ({ length_m: conductor.lengthM, L_h_per_m: L ? L[i][i] / conductor.lengthM : null, C_f_per_m: C ? C[i][i] / conductor.lengthM : null, raw_grounded_C_f_per_m: primitiveC ? primitiveC[i][i] / conductor.lengthM : null })) },
    eyes: null, quiet_NEXT_FEXT: null, timestep_section_deltas: null }
  if (summary.status === 'verified_native') {
    const plot = `${example}${block ? `-${block}` : ''}.json.gz`
    await copyFile(`${directory}/plot-evidence.json.gz`, `${output}/${plot}`)
    Object.assign(item, { plot_file: plot, eyes: summary.blocks.flatMap((b: any) => b.results.filter((r: any) => r.type === 'simulation_signal_eye')), quiet_NEXT_FEXT: summary.blocks.flatMap((b: any) => b.results.filter((r: any) => r.type === 'simulation_signal_crosstalk')), timestep_section_deltas: summary.transient_convergence })
  }
  cases.push(item)
}
const ddr = JSON.parse(await readFile('runs/ddr3-boundary.json', 'utf8'))
cases.push({ ...ddr, example: 'level4-ddr3-write', example_sha256: digest(await readFile('examples/levels/level4-ddr3-write.tsx')), accepted: false, eyes: null, quiet_NEXT_FEXT: null, timestep_section_deltas: null })
await writeFile(`${output}/rfc-boards.json`, JSON.stringify({ rfc_head: 'a235ddd1ba93de1245ab07f3497511a860c81345',
  native_binary_sha256: binaries,
  acceptance: { R_L_mesh: .05, C_auto: .02, reciprocity: .025, transient: '1% + 1 mV; integrated RMS and signed extrema, independent timestep and section refinements' },
  note: 'No RFC channel is accepted. Raw rejected matrices are plausibility diagnostics only; no transient uses them.', cases }, null, 2) + '\n')
const plane = JSON.parse(await readFile('runs/plane-extraction-final-v2/summary.json', 'utf8'))
await writeFile(`${output}/plane-extraction.json`, JSON.stringify({ ...plane, native_binary_sha256: binaries }, null, 2) + '\n')
await copyFile('runs/ddr3-boundary.json', `${output}/ddr3-boundary.json`)
console.log(cases.map(item => ({ example: item.example, block: item.block, status: item.status, error: item.error })))
