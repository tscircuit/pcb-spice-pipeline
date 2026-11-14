import test from 'node:test'
import assert from 'node:assert/strict'
import { routedCopper } from '../support/routed-fixture'
import { segmentRoutes, type RouteWire, type RouteXY } from '../../src/board'
import { RouteFieldsSolver } from '../../src/extraction'
import { routeLadder, type RouteLadder } from '../../src/simulation/route-ladder'
import { solveCrossSection, type CrossSection } from '../../src/extraction/cross-section'
import type { ExtractedRoutes, RouteCoefficients } from '../../src/extraction/route-lines'
import { crossingTime, ngspiceAvailable, runGoldenDeck, valueAt } from '../support/golden-checks'

/** Electrical identity follows physical TSX copper endpoints. */
const endpoint = (wire: RouteWire, point: RouteXY): string => `${wire.layer}_${point.map(value => value.toFixed(8)).join('_')}`

test('actual routed TSX exceeds the old 1024-cell cap with locally supported coupling', async () => {
  const { circuitJson, scope } = await routedCopper()
  const fields = new RouteFieldsSolver({ geometry: segmentRoutes(circuitJson, scope), artifactPrefix: 'test' })
  fields.solve()
  const result = routeLadder(fields.getOutput().value, endpoint, 1e-12)
  assert.ok(result.cells > 1024)
  const couplings = result.lines.filter(line => line.startsWith('K'))
  assert.ok(couplings.length > 0)
  assert.ok(couplings.length < result.cells * 30, 'fixed-width local slices scale with cell count')
  assert.ok(result.lines.some(line => line.startsWith('GARCS')), 'actual TSX copper exercises coupled Foster resistance')
  assert.equal(result.lines.filter(line => /^[VH]ARCS/.test(line)).length, 0, 'tiny Foster voltages must not be differences along sensor/CCVS chains')
  assert.ok(result.lines.filter(line => /^RARCS/.test(line)).every(line => line.split(' ')[2] !== '0' || line.endsWith(' 1')), 'coupled resistance equations have unit diagonal')
})

// ---- Golden known-answer checks for stages 5–6 (docs/golden-checks.md). The ladder is the lowest layer that
// builds a plain line: straight parallel wires get the solved per-unit-length matrices of one cross-section.
// Expected values and tolerances are fixed from transmission-line theory before ngspice runs.
const lightSpeed = 299792458
const lengthMm = 100
const riseSeconds = 100e-12

/** Straight parallel wires along x, one per section conductor; conductor loss is scaled (1e-3 = near-lossless). */
function straightLine(section: CrossSection, lossScale: number): { extracted: ExtractedRoutes; line: RouteCoefficients; ladder: RouteLadder } {
  const solved = solveCrossSection(section)
  const line: RouteCoefficients = { conductorIds: solved.conductorIds, C: solved.C, C0: solved.C0, L: solved.L, dielectricLoss: solved.dielectricLoss, diagnostics: solved.diagnostics,
    dcResistance: solved.dcResistance.map(row => row.map(value => value * lossScale)), skinResistance: solved.skinResistance.map(row => row.map(value => value * lossScale)) }
  const wires: RouteWire[] = section.conductors.map((conductor, i) => ({ id: i, trace: `t${i}`, source: `s${i}`, layer: 'inner1', width: conductor.widthMm,
    a: [0, conductor.xMm], b: [lengthMm, conductor.xMm], u: [1, 0], start: 0, end: lengthMm, transverse: conductor.xMm }))
  const extracted: ExtractedRoutes = { slices: [{ wires, start: 0, end: lengthMm, references: [], key: 'golden', line }], sections: [{ key: 'golden', line }],
    materials: { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 }, warnings: [], coupling: [] }
  const interior = new Map<string, string>()
  /** Ends are near<i>/far<i>; interior cell boundaries get stable unique names. */
  const endpoint = (wire: RouteWire, point: RouteXY): string => {
    if (Math.abs(point[0]) < 1e-9) return `near${wire.id}`
    if (Math.abs(point[0] - lengthMm) < 1e-9) return `far${wire.id}`
    const key = `${wire.id}:${point[0].toFixed(6)}`
    if (!interior.has(key)) interior.set(key, `n${interior.size}`)
    return interior.get(key)!
  }
  return { extracted, line, ladder: routeLadder(extracted, endpoint, riseSeconds) }
}

/** Homogeneous er = 4 stripline (b = 1 mm): every mode travels at exactly c/sqrt(er), whatever the field-solver error. */
const stripline: CrossSection = { conductors: [{ id: 's', xMm: 0, zMm: .4825, widthMm: .35, thicknessMm: .035 }], planes: [{ zMm: 0 }, { zMm: 1 }], dielectrics: [{ zMm: 0, thicknessMm: 1, er: 4, lossTangent: 0 }] }
/** Inhomogeneous microstrip pair (h = 0.5 mm, er = 4 below, air above): distinct even and odd velocities. */
const microstripPair: CrossSection = { conductors: [-.375, .375].map((x, i) => ({ id: `m${i}`, xMm: x, zMm: .5, widthMm: .5, thicknessMm: .035 })), planes: [{ zMm: 0 }], dielectrics: [{ zMm: 0, thicknessMm: .5, er: 4, lossTangent: 0 }] }

/** Sum of the values of every emitted element whose line matches `pattern`. */
function total(lines: string[], pattern: RegExp): number {
  return lines.filter(line => pattern.test(line)).reduce((sum, line) => sum + Number(line.split(' ')[3]), 0)
}

test('golden stage 5: ladder elements integrate to L l, C l, R l and K = L12/sqrt(L11 L22)', () => {
  // The ladder must conserve per-unit-length energy: summed series L and DC R equal L l and R l, summed shunt C to
  // ground equals the row sums (C11 + C12) l, summed pair C equals |C12| l, and every K is the section's exact
  // L12/sqrt(L11 L22) (Paul, MTL 2nd ed., section 7.1, lumped-pi discretization). Tolerance 1e-9 relative: the deck
  // prints 12 significant digits.
  const metres = lengthMm / 1000
  for (const [label, section] of [['stripline', stripline], ['microstrip pair', microstripPair]] as const) {
    const { line, ladder } = straightLine(section, 1)
    const size = line.L.length
    const inductance = Array.from({ length: size }, (_, i) => line.L[i][i] * metres).reduce((a, b) => a + b, 0)
    const resistance = Array.from({ length: size }, (_, i) => line.dcResistance[i][i] * metres).reduce((a, b) => a + b, 0)
    const ground = line.C.flat().reduce((a, b) => a + b, 0) * metres
    const pair = size > 1 ? Math.abs(line.C[0][1]) * metres : 0
    const shunts = ladder.lines.filter(entry => /^CARCCS\d+ /.test(entry)).map(entry => entry.split(' '))
    /** Relative agreement within the 1e-9 print-precision tolerance. */
    const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 1e-9 * Math.abs(expected)
    assert.ok(near(total(ladder.lines, /^LARCL\d+ /), inductance), `${label}: series L`)
    assert.ok(near(total(ladder.lines, /^RARCD\d+ /), resistance), `${label}: DC R`)
    assert.ok(near(shunts.filter(entry => entry[2] === '0').reduce((sum, entry) => sum + Number(entry[3]), 0), ground), `${label}: C to ground`)
    if (size > 1) {
      assert.ok(near(shunts.filter(entry => entry[2] !== '0').reduce((sum, entry) => sum + Number(entry[3]), 0), pair), `${label}: pair C`)
      const expected = line.L[0][1] / Math.sqrt(line.L[0][0] * line.L[1][1])
      const couplings = ladder.lines.filter(entry => entry.startsWith('KARCL')).map(entry => Number(entry.split(' ')[3]))
      assert.ok(couplings.length === ladder.cells / 2 && couplings.every(k => Math.abs(k / expected - 1) <= 1e-9 && Math.abs(k) < 1), `${label}: K`)
    }
    console.log(`${label}: ${ladder.cells} cells, maximum cell delay ${(ladder.maximumDelaySeconds * 1e12).toFixed(3)} ps`)
  }
})

const native = process.env.SI_NATIVE_TESTS !== '1' && 'Set SI_NATIVE_TESTS=1 for bounded sequential native checks'

/** One small transient deck: ramp sources, the ladder, resistive loads and wrdata of the named nodes. */
function transientDeck(title: string, ladder: RouteLadder, sources: { node: string; resistance: number; sign: number }[], loads: { node: string; resistance: number }[], stopSeconds: number, probes: string[]): string {
  return [`* ${title}`, '.options klu reltol=1e-4 abstol=1e-12 vntol=1e-7 pivrel=0.1',
    ...sources.flatMap((source, i) => [`VS${i} src${i} 0 PWL(0 0 50p 0 150p ${source.sign})`, `RS${i} src${i} ${source.node} ${source.resistance}`]),
    ...ladder.lines, ...loads.map((load, i) => `RL${i} ${load.node} 0 ${load.resistance}`),
    '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=12', `tran 1p ${stopSeconds} 0 1p`, `wrdata golden.dat ${probes.map(node => `v(${node})`).join(' ')}`, 'quit', '.endc', '.end'].join('\n') + '\n'
}

// Homogeneous stripline: T = l sqrt(er)/c exactly. Source and load equal the extracted Z0 = sqrt(L/C), so the
// reflection coefficient is zero (Pozar, Microwave Engineering, section 2.3). Declared tolerances: delay (far 50% minus
// near 50% of the 0.5 V incident step) within 1% of T, since ladder dispersion at 10 cells per rise is ~0.2%; both
// ends within 2% of the 0.5 V incident level from the end of the edge to 3T. One shared ngspice run.
let matched: Promise<{ rows: number[][]; delay: number; z: number; cells: number }> | undefined
/** Run the matched-line deck once for both matched-line checks. */
function matchedRun(): Promise<{ rows: number[][]; delay: number; z: number; cells: number }> {
  matched ??= (async () => {
    const { line, ladder } = straightLine(stripline, 1e-3)
    const z = Math.sqrt(line.L[0][0] / line.C[0][0])
    const delay = lengthMm / 1000 * 2 / lightSpeed
    const rows = await runGoldenDeck(transientDeck('matched', ladder, [{ node: 'near0', resistance: z, sign: 1 }], [{ node: 'far0', resistance: z }], 3 * delay + 2e-10, ['near0', 'far0']))
    return { rows, delay, z, cells: ladder.cells }
  })()
  return matched
}

test('golden stage 6: matched line delay is l sqrt(er)/c and the near end sees no reflection', { skip: native }, async context => {
  if (!ngspiceAvailable()) return context.skip('ngspice is not on PATH')
  const { rows, delay, z, cells } = await matchedRun()
  const measured = crossingTime(rows, 2, .25) - crossingTime(rows, 1, .25)
  const nearRipple = Math.max(...rows.filter(row => row[0] >= 2e-10 && row[0] <= 3 * delay).map(row => Math.abs(row[1] - .5)))
  context.diagnostic(JSON.stringify({ z0: z, cells, expectedDelayPs: delay * 1e12, measuredDelayPs: measured * 1e12, delayError: measured / delay - 1, nearRippleV: nearRipple }))
  assert.ok(Math.abs(measured / delay - 1) <= .01, `delay ${measured} vs ${delay}`)
  assert.ok(nearRipple <= .01, `near-end reflection ripple ${nearRipple} V`)
})

test('golden stage 6: matched line far end stays at the incident level after the edge', { skip: native }, async context => {
  if (!ngspiceAvailable()) return context.skip('ngspice is not on PATH')
  const { rows, delay } = await matchedRun()
  const farRipple = Math.max(...rows.filter(row => row[0] >= delay + 2e-10 && row[0] <= 3 * delay).map(row => Math.abs(row[2] - .5)))
  context.diagnostic(JSON.stringify({ farRippleV: farRipple }))
  assert.ok(farRipple <= .01, `far-end ripple ${farRipple} V`)
})

/** Bounce-diagram (lattice) voltage at one end, t seconds after launch, for an ideal unit-time-delay step. */
function lattice(time: number, delay: number, incident: number, source: number, load: number, end: 'near' | 'far'): number {
  let value = end === 'near' ? incident : 0
  for (let k = 0; k < 64; k++) {
    const wave = incident * (source * load) ** k
    if (end === 'far' && (2 * k + 1) * delay < time) value += wave * (1 + load)
    if (end === 'near' && (2 * k + 2) * delay < time) value += wave * load * (1 + source)
  }
  return value
}

test('golden stage 6: open end doubles the wave and bounces follow the lattice diagram', { skip: native }, async context => {
  if (!ngspiceAvailable()) return context.skip('ngspice is not on PATH')
  // Rs = Z0/3 gives Gamma_S = -1/2; the open end gives Gamma_L = +1 (1 Gohm). Lattice diagram (Bergeron; Johnson &
  // Graham, High-Speed Digital Design, section 4.3): far-end steps at (2k+1)T, near-end steps at 2kT, plateaus from the
  // summed reflections, first far plateau = 2 x incident. Tolerances: every plateau (k = 0..3, sampled mid-plateau)
  // within 2% of the 1 V source swing; every step's mid-level crossing within 1% of its ideal time after launch.
  const { line, ladder } = straightLine(stripline, 1e-3)
  const z = Math.sqrt(line.L[0][0] / line.C[0][0])
  const delay = lengthMm / 1000 * 2 / lightSpeed
  const incident = z / (z / 3 + z)
  const source = (z / 3 - z) / (z / 3 + z)
  const load = (1e9 - z) / (1e9 + z)
  const rows = await runGoldenDeck(transientDeck('open', ladder, [{ node: 'near0', resistance: z / 3, sign: 1 }], [{ node: 'far0', resistance: 1e9 }], 8.5 * delay, ['near0', 'far0']))
  const launch = crossingTime(rows, 1, incident / 2)
  const failures: string[] = []
  const records: Record<string, number | string>[] = []
  for (const [end, column, first] of [['far', 2, 1], ['near', 1, 0]] as const) for (let k = 0; k < 4; k++) {
    const middle = (first + 2 * k + 1) * delay
    const expected = lattice(middle, delay, incident, source, load, end)
    const value = valueAt(rows, column, launch + middle)
    if (!(Math.abs(value - expected) <= .02)) failures.push(`${end} plateau ${k}: ${value} vs ${expected}`)
    const step = (first + 2 * k) * delay
    if (step > 0) {
      const level = (lattice(step - delay / 2, delay, incident, source, load, end) + expected) / 2
      const crossing = crossingTime(rows, column, level, launch + step - delay / 2) - launch
      if (!(Math.abs(crossing / step - 1) <= .01)) failures.push(`${end} step ${k} at ${crossing} vs ${step}`)
      records.push({ end, k, plateauV: value, expectedV: expected, stepPs: crossing * 1e12, expectedStepPs: step * 1e12 })
    }
  }
  context.diagnostic(JSON.stringify(records))
  assert.deepEqual(failures, [])
})

test('golden stage 6: symmetric coupled pair carries even and odd modes at their own L/C velocities', { skip: native }, async context => {
  if (!ngspiceAvailable()) return context.skip('ngspice is not on PATH')
  // Symmetric pair: even mode L_e = L11 + L12, C_e = C11 + C12; odd mode with the minus sign; T_m = l sqrt(L_m C_m),
  // Z_m = sqrt(L_m/C_m) (Paul, MTL 2nd ed., section 5.2). Pure modal drive with modal terminations launches only that
  // mode. Tolerance: each modal delay (far minus near 50% crossings) within 1% of its prediction.
  const { line, ladder } = straightLine(microstripPair, 1e-3)
  const failures: string[] = []
  const records: Record<string, number>[] = []
  for (const sign of [1, -1]) {
    const L = line.L[0][0] + sign * line.L[0][1]
    const C = line.C[0][0] + sign * line.C[0][1]
    const z = Math.sqrt(L / C)
    const delay = lengthMm / 1000 * Math.sqrt(L * C)
    const rows = await runGoldenDeck(transientDeck(sign > 0 ? 'even' : 'odd', ladder, [{ node: 'near0', resistance: z, sign: 1 }, { node: 'near1', resistance: z, sign }],
      [{ node: 'far0', resistance: z }, { node: 'far1', resistance: z }], 2 * delay + 3e-10, ['near0', 'far0']))
    const measured = crossingTime(rows, 2, .25) - crossingTime(rows, 1, .25)
    records.push({ mode: sign, z, expectedDelayPs: delay * 1e12, measuredDelayPs: measured * 1e12, error: measured / delay - 1 })
    if (!(Math.abs(measured / delay - 1) <= .01)) failures.push(`${sign > 0 ? 'even' : 'odd'}: ${measured} vs ${delay}`)
  }
  context.diagnostic(JSON.stringify(records))
  assert.deepEqual(failures, [])
})

test('golden stage 6: settled voltage equals the DC divider including the line resistance', { skip: native }, async context => {
  if (!ngspiceAvailable()) return context.skip('ngspice is not on PATH')
  // At DC every Foster inductor shorts its resistor and every dielectric branch is open, so the line is R_dc l in
  // series: V_far = Vs RL/(Rs + R l + RL), V_near = Vs (R l + RL)/(Rs + R l + RL), with R = 1/(sigma w t) from the
  // geometry, not from the solver. Evaluated with ngspice .op, the t -> infinity state: the slowest Foster pole
  // (10 kHz) needs ~16 us of transient. Tolerance 1e-5 V: a linear DC solve is exact to gmin (1e-12 S) effects.
  const section: CrossSection = { conductors: [{ id: 's', xMm: 0, zMm: .491, widthMm: .1, thicknessMm: .018 }], planes: [{ zMm: 0 }, { zMm: 1 }], dielectrics: [{ zMm: 0, thicknessMm: 1, er: 4, lossTangent: .02 }] }
  const { ladder } = straightLine(section, 1)
  const resistance = lengthMm / 1000 / (5.8e7 * .1e-3 * .018e-3)
  const deck = ['* dc divider', 'VS0 src0 0 DC 1', 'RS0 src0 near0 25', ...ladder.lines, 'RL0 far0 0 25', '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=12', 'op', 'wrdata golden.dat v(near0) v(far0)', 'quit', '.endc', '.end'].join('\n') + '\n'
  const [row] = await runGoldenDeck(deck)
  const near = row.at(-2)!
  const far = row.at(-1)!
  const expectedNear = (resistance + 25) / (50 + resistance)
  const expectedFar = 25 / (50 + resistance)
  context.diagnostic(JSON.stringify({ lineResistance: resistance, near, expectedNear, far, expectedFar }))
  assert.ok(Math.abs(near - expectedNear) <= 1e-5 && Math.abs(far - expectedFar) <= 1e-5, `near ${near} vs ${expectedNear}, far ${far} vs ${expectedFar}`)
})
