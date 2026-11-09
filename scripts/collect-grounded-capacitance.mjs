// Option A evidence only. Run after the fresh fixture and Level 1/2 native runners.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { parseFasterCap, parseFastHenry, loopImpedance } from '../src/extraction/index.js'

const root = process.env.SI_RUN_ROOT ?? 'runs/option-a'
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const sum = values => values.reduce((a, b) => a + b, 0)
const residual = matrix => Math.max(...matrix.flatMap((row, i) => row.map((value, j) => Math.abs(value - matrix[j][i])))) / Math.max(...matrix.flat().map(Math.abs))
const block = matrix => matrix.slice(0, -1).map(row => row.slice(0, -1))
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const { exp, log, log10, sin, cosh, sqrt, PI } = Math

// Independently evaluate the published zero-thickness H/J equations, Qucs
// technical manual 11.4–6, 11.15–17, 11.156–174. No solver value enters this estimate.
const er = 4.42
const u = .15 / 1.43
const g = (.75 - .15) / 1.43
const c = 299792458
const zfree = 376.730313668
const shape = width => 1 + log((width ** 4 + (width / 52) ** 2) / (width ** 4 + .432)) / 49 + log(1 + (width / 18.1) ** 3) / 18.7
const material = .564 * ((er - .9) / (er + 3)) ** .053
const filling = width => (1 + 10 / width) ** (-shape(width) * material)
const epsilon = width => (er + 1) / 2 + (er - 1) / 2 * filling(width)
const zair = zfree / (2 * PI) * log((6 + (2 * PI - 6) * exp(-((30.666 / u) ** .7528))) / u + sqrt(1 + (2 / u) ** 2))
const m = .2175 + (4.113 + (20.36 / g) ** 6) ** (-.251) + log(g ** 10 / (1 + (g / 13.8) ** 10)) / 323
const alpha = .5 * exp(-g)
const psi = 1 + g / 1.45 + g ** 2.09 / 3.95
const phiEven = .8645 * u ** .172 / (psi * (alpha * u ** m + (1 - alpha) * u ** (-m)))
const n = (1 / 17.7 + exp(-6.424 - .76 * log(g) - (g / .23) ** 5)) * log((10 + 68.3 * g ** 2) / (1 + 32.5 * g ** 3.093))
const beta = .2306 + log(g ** 10 / (1 + (g / 3.73) ** 10)) / 301.8 + log(1 + .646 * g ** 1.175) / 5.3
const theta = 1.729 + 1.175 * log(1 + .627 / (g + .327 * g ** 2.17))
const phiOdd = phiEven - theta / psi * exp(beta * u ** (-n) * log(u))
const r = 1 + .15 * (1 - exp(1 - (er - 1) ** 2 / 8.2) / (1 + g ** (-6)))
const factor = 1 - exp(-.179 * g ** .15 - .328 * g ** r / log(Math.E + (g / 7) ** 2.8))
const p = exp(-.745 * g ** .295) / cosh(g ** .68)
const q = exp(-1.366 - g)
const oddFilling = factor * exp(p * log(u) + q * sin(PI * log10(u))) * filling(u)
const ee = epsilon(g * exp(-g) + u * (20 + g ** 2) / (10 + g ** 2))
const eo = (er + 1) / 2 + (er - 1) / 2 * oddFilling
const zeAir = zair / (1 - zair * phiEven / zfree)
const zoAir = zair / (1 - zair * phiOdd / zfree)
const ce = ee / (c * zeAir)
const co = eo / (c * zoAir)
const analytic = { source: 'https://qucs.sourceforge.net/tech/node77.html', single_source: 'https://qucs.sourceforge.net/tech/node75.html',
  model: 'Hammerstad/Jensen, zero thickness, infinite ground, quasi-static homogeneous mode impedance divided by sqrt(mode effective permittivity)',
  width_mm: .15, height_mm: 1.43, edge_gap_mm: .6, er, u, g, single_C_pf_per_m: epsilon(u) / (c * zair) * 1e12,
  even_epsilon: ee, odd_epsilon: eo, even_Z_ohm: zeAir / sqrt(ee), odd_Z_ohm: zoAir / sqrt(eo),
  even_C_pf_per_m: ce * 1e12, odd_C_pf_per_m: co * 1e12, diagonal_C_pf_per_m: (ce + co) / 2 * 1e12, mutual_C_pf_per_m: (co - ce) / 2 * 1e12 }

const matrixEvidence = matrix => {
  const signal = block(matrix)
  const rows = matrix.map(sum)
  const columns = matrix.map((_, j) => sum(matrix.map(row => row[j])))
  const denominator = sum(rows)
  return { primitive_C_f: matrix, signal_C_f: signal, full_reciprocity: residual(matrix), signal_reciprocity: residual(signal),
    asymmetric_pairs: matrix.flatMap((row, i) => row.flatMap((value, j) => j <= i ? [] : [{ row: i, column: j, signal_return: j === matrix.length - 1, Cij_f: value, Cji_f: matrix[j][i], difference_f: value - matrix[j][i] }])),
    grounded_total_charge_per_signal_charge: signal.map((row, i) => columns[i] / row[i]),
    raw_formal_neutral_C_f: signal.map((row, i) => row.map((value, j) => value - rows[i] * columns[j] / denominator)),
    raw_formal_neutral_diagonal_fraction: signal.map((row, i) => rows[i] * columns[i] / denominator / row[i]),
    neutral_diagnostic_note: 'Algebra only on the unvalidated nonreciprocal primitive: Css-(C1)s*(1^T C)s/(1^T C1). Not an accepted floating model or a physical error estimate.' }
}
const fixtures = read(`${root}/fixtures/summary.json`).map(sample => ({ ...sample, ...matrixEvidence(sample.matrix),
  mutual_C_pf_per_m: sample.coupled ? [0, 1].map(i => -sample.matrix[i][1 - i] / .04 * 1e12) : null,
  diagonal_vs_analytic_fraction: sample.grounded_diagonal_pf_per_m.map(value => value / (sample.coupled ? analytic.diagonal_C_pf_per_m : analytic.single_C_pf_per_m) - 1),
  mutual_vs_analytic_fraction: sample.coupled ? [0, 1].map(i => -sample.matrix[i][1 - i] / .04 * 1e12 / analytic.mutual_C_pf_per_m - 1) : null }))
const old = read('tests/evidence/signal-levels/rfc-boards.json')
const levels = ['single', 'differential', 'two'].map(name => {
  const directory = name === 'single' ? `${root}/levels/single` : `${root}/resume/${name}`
  const run = read(`${directory}/summary.json`)
  const requests = read(`${directory}/native-calls.json`)
  const index = requests.findIndex(call => call.solver === 'fastercap')
  const capComplete = index >= 0 && existsSync(`${directory}/native-${index}-fastercap/stdout.log`)
  const matrix = !capComplete ? null : parseFasterCap(readFileSync(`${directory}/native-${index}-fastercap/stdout.log`, 'utf8')).matrix.map(row => row.map(value => value * .001))
  const baseline = old.cases.find(entry => entry.name === name)
  const nativeText = (index, file) => {
    const path = `${directory}/native-${index}-fasthenry/${file}`
    return existsSync(path) ? readFileSync(path, 'utf8') : gunzipSync(readFileSync(`${path}.gz`)).toString()
  }
  const coarse = parseFastHenry(nativeText(0, 'Zc.mat')).find(sample => Math.abs(sample.frequencyHz / baseline.numerical_settings.extraction.modelHz - 1) < 1e-8)
  const refinedPath = `${directory}/native-1-fasthenry/Zc.mat`
  const refined = existsSync(refinedPath) || existsSync(`${refinedPath}.gz`) ? parseFastHenry(nativeText(1, 'Zc.mat'))[0] : null
  const R = refined ? loopImpedance(refined.R) : null
  const L = refined ? loopImpedance(refined.L) : null
  const mesh = !refined ? { R: null, L: null } : Object.fromEntries(['R', 'L'].map(kind => {
    const a = loopImpedance(coarse[kind])
    const b = loopImpedance(refined[kind])
    return [kind, Math.max(...b.flatMap((row, i) => row.map((value, j) => Math.abs(value - a[i][j])))) / Math.max(...b.flat().map(Math.abs))]
  }))
  return { ...run, run_directory: directory, replay_used: requests.some(call => call.exact_native_extraction_replay_from || call.exact_native_transient_replay_from), native_requests: requests,
    matrix_evidence: matrix ? matrixEvidence(matrix) : null,
    extraction_accepted: index >= 0 && requests.some(call => call.solver === 'ngspice'),
    cap_auto_residual: !capComplete ? null : Number([...readFileSync(`${directory}/native-${index}-fastercap/stdout.log`, 'utf8').matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)?.[1]),
    accepted_extraction: run.blocks?.flatMap(entry => entry.extraction) ?? null,
    input_sha256: sha(`${directory}/input.json`), baseline_input_sha256: baseline.input_sha256,
    extraction_requests_match_baseline: requests.slice(0, 3).every((call, i) => call.request_sha256 === baseline.native_execution[i].request_sha256),
    R_mesh_delta: mesh.R, L_mesh_delta: mesh.L,
    raw_loop_R_ohm: R, raw_loop_L_h: L,
    per_length: baseline.extraction.per_length.map((entry, i) => ({ length_m: entry.length_m, L_h_per_m: L ? L[i][i] / entry.length_m : null, C_f_per_m: matrix ? matrix[i][i] / entry.length_m : null })),
    eyes: run.blocks?.flatMap(entry => entry.results.filter(result => result.type === 'simulation_signal_eye')) ?? null,
    quiet_NEXT_FEXT: null, quiet_NEXT_FEXT_note: 'Not applicable: these three boards declare switching signals, no quiet victim. No quiet scenario was invented.',
    timestep_section_deltas: run.transient_convergence ?? run.convergence ?? null }
})
const output = { experiment: 'A: raw grounded signal block, no averaging', base_head: '1eacbdd', acceptance: old.acceptance,
  binaries_sha256: Object.fromEntries(['/opt/homebrew/bin/fasthenry', '/opt/homebrew/bin/FasterCap', '/opt/homebrew/bin/ngspice'].map(path => [path, sha(path)])),
  overlays: { IBIS_MODEL_DIR: 'models (vendor symlink, uncommitted)', SI_CORE_MODULE: process.env.SI_CORE_MODULE, TSX_TSCONFIG_PATH: 'examples/tsconfig.json', NGSPICE_BIN: '/opt/homebrew/bin/ngspice' },
  analytic, fixtures, levels, interruption: read(`${root}/interruption.json`),
  initial_level2_attempt: (() => { const attempt = read(`${root}/levels/two/summary.json`); return { status: attempt.status, seconds: attempt.seconds, error: attempt.error.split('\n')[0], code: attempt.code, native_execution: attempt.native_execution, note: 'Fresh 600 s process-bound attempt stopped in refined FastHenry before C; one fresh 900 s retry is reported above.' } })(),
  verification: Object.fromEntries(['npm-test-final', 'typecheck-final', 'lint-final', 'check-modules', 'check-vocabulary', 'native-fixture-tests', 'script-typecheck'].filter(name => existsSync(`${root}/${name}.log`)).map(name => [name, { log: `${root}/${name}.log`, sha256: sha(`${root}/${name}.log`), tail: readFileSync(`${root}/${name}.log`, 'utf8').split('\n').slice(-12).join('\n') }])) }
writeFileSync('tests/evidence/signal-levels/grounded-capacitance-option-a.json', JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ analytic, fixtures: fixtures.map(sample => ({ coupled: sample.coupled, full: sample.full_reciprocity, signal: sample.signal_reciprocity, C: sample.grounded_diagonal_pf_per_m, mutual: sample.mutual_C_pf_per_m })), levels: levels.map(entry => ({ name: entry.name, status: entry.status, error: entry.error, seconds: entry.seconds })) }, null, 2))
