import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCrossSection, solveSectionCapacitance, type CrossSection, type CrossSectionResult, type Matrix } from '../../src/extraction'
import { coupledMicrostrip, coupledStripline, pozarStriplineResistance, singleMicrostrip, stripline } from './cross-section-reference'
import { sectionFixture } from './cross-section-fixtures'
import { energyFacts, maxwellFacts } from '../support/golden-checks'

const c = 299792458

/** Independent Cholesky test of strict positive definiteness, scaled to matrix magnitude. */
function positive(matrix: Matrix): void {
  const a = matrix.map(row => [...row])
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j <= i; j++) {
      let value = a[i][j]
      for (let k = 0; k < j; k++) value -= a[i][k] * a[j][k]
      if (i === j) {
        assert.ok(value > 0, `positive pivot ${i}: ${value}`)
        a[i][j] = Math.sqrt(value)
      } else a[i][j] = value / a[j][j]
    }
  }
}

/** Both scalar modal impedances, for two identical lines in a symmetric cross-section. */
function modes(result: CrossSectionResult): { ze: number; zo: number; ee: number; eo: number } {
  return {
    ze: Math.sqrt((result.L[0][0] + result.L[0][1]) / (result.C[0][0] + result.C[0][1])),
    zo: Math.sqrt((result.L[0][0] - result.L[0][1]) / (result.C[0][0] - result.C[0][1])),
    ee: (result.C[0][0] + result.C[0][1]) / (result.C0[0][0] + result.C0[0][1]),
    eo: (result.C[0][0] - result.C[0][1]) / (result.C0[0][0] - result.C0[0][1]),
  }
}

/** Relative coefficient error, including mutual coefficients rather than just a diagonal norm. */
function error(actual: number, expected: number): number {
  return Math.abs(actual / expected - 1)
}

/** Compare material and vacuum capacitance, inductance and energy loss under mesh/domain changes. */
function change(a: CrossSectionResult, b: CrossSectionResult): number {
  let largest = 0
  for (const key of ['C', 'C0', 'L', 'dielectricLoss'] as const) for (let i = 0; i < a.C.length; i++) for (let j = 0; j < a.C.length; j++) largest = Math.max(largest, error(a[key][i][j], b[key][i][j]))
  return largest
}

test('2D extraction: independent single/coupled formulas, matrix energy, loss, convergence and twelve-line timing', () => {
  const rows: Record<string, string | number>[] = []
  for (const kind of ['microstrip', 'stripline'] as const) for (const count of [1, 2]) {
    const section = sectionFixture(kind, count)
    const start = performance.now()
    const result = solveCrossSection(section)
    const elapsed = performance.now() - start
    let maximum = 0
    if (count === 1) {
      const single = kind === 'microstrip' ? singleMicrostrip(1, 4) : { z: coupledStripline(1, 100, 2.001, 4).ze, ee: 4 }
      const C = Math.sqrt(single.ee) / (c * single.z)
      const L = single.z * Math.sqrt(single.ee) / c
      maximum = Math.max(error(result.C[0][0], C), error(result.L[0][0], L), error(Math.sqrt(result.L[0][0] / result.C[0][0]), single.z), error(Math.sqrt(result.L[0][0] * result.C[0][0]), Math.sqrt(single.ee) / c))
    } else {
      const expected = kind === 'microstrip' ? coupledMicrostrip(1, .5, 4) : { ...coupledStripline(1, .5, 2.001, 4), ee: 4, eo: 4 }
      const actual = modes(result)
      maximum = Math.max(...(['ze', 'zo'] as const).map(key => error(actual[key], expected[key])), error(result.L[0][1], expected.l12), error(result.C[0][1], expected.c12))
      for (const [sign, ee, z] of [[1, expected.ee, expected.ze], [-1, expected.eo, expected.zo]]) {
        const cm = result.C[0][0] + sign * result.C[0][1]
        const lm = result.L[0][0] + sign * result.L[0][1]
        maximum = Math.max(maximum, error(cm, Math.sqrt(ee) / (c * z)), error(lm, z * Math.sqrt(ee) / c), error(Math.sqrt(lm * cm), Math.sqrt(ee) / c))
      }
    }
    assert.ok(maximum < .02, `${kind} ${count}: worst C/L/Z/delay/mutual error ${maximum}`)
    rows.push({ fixture: `${kind} ${count}`, panels: result.diagnostics.panels, ms: +elapsed.toFixed(2), worstErrorPercent: +(100 * maximum).toFixed(3) })
    for (const matrix of [result.C, result.C0, result.L, result.dielectricLoss, result.skinResistance, result.atFrequency(1e9).R, result.atFrequency(1e9).G]) {
      positive(matrix)
      for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) assert.ok(Math.abs(matrix[i][j] - matrix[j][i]) < 1e-14 * Math.abs(matrix[i][i]))
    }
    assert.ok(result.diagnostics.reciprocityResidual < .005)
    assert.deepEqual(result.atFrequency(0), { R: result.dcResistance, G: result.C.map(row => row.map(() => 0)) })
  }
  const fixture = sectionFixture('microstrip', 2)
  const start = performance.now()
  const base = solveCrossSection(fixture)
  const fine = solveCrossSection(fixture, { panelsPerEdge: 16 })
  const wide = solveCrossSection(fixture, { interfaceExtent: 48 })
  const mesh = change(base, fine)
  const domain = change(base, wide)
  assert.ok(mesh < .01, `mesh coefficient change ${mesh}`)
  assert.ok(domain < .01, `domain coefficient change ${domain}`)
  rows.push({ fixture: 'pair mesh 12→16 + domain 24→48 (all three)', ms: +(performance.now() - start).toFixed(2), meshPercent: +(100 * mesh).toFixed(3), domainPercent: +(100 * domain).toFixed(3) })
  for (const kind of ['microstrip', 'mask', 'stripline'] as const) {
    const begin = performance.now()
    const result = solveCrossSection(sectionFixture(kind, 12))
    const elapsed = performance.now() - begin
    for (const matrix of [result.C, result.C0, result.L, result.skinResistance, result.atFrequency(1e9).R, result.atFrequency(1e9).G]) positive(matrix)
    assert.ok(result.diagnostics.reciprocityResidual < .005)
    assert.ok(result.C.every((row, i) => row.every((value, j) => i === j ? value > 0 : value <= 0)))
    rows.push({ fixture: `${kind} 12`, panels: result.diagnostics.panels, ms: +elapsed.toFixed(2), rawReciprocityPercent: +(result.diagnostics.reciprocityResidual * 100).toFixed(3) })
  }
  console.table(rows)
})


test('electrostatic-only path is byte-exact with full extraction for one/two-plane coupled sections', () => {
  for (const kind of ['microstrip', 'stripline'] as const) {
    const section = sectionFixture(kind, 2)
    assert.deepEqual(solveSectionCapacitance(section), solveCrossSection(section).C)
  }
  assert.throws(() => solveSectionCapacitance(sectionFixture('microstrip', 1), { panelsPerEdge: 2 }), /panels per edge/)
})

// ---- Golden known-answer checks (docs/golden-checks.md). Expected values and tolerances are fixed from the
// cited physics before the solver runs; a failing check is reported, never loosened.
// CODATA 2018 constants, defined independently of the solver.
const epsilon0 = 8.8541878128e-12
const mu0 = 1.25663706212e-6
const copper = 5.8e7

/** One strip of width w and thickness t centred between planes at z = 0 and b (mm), filled with one lossless dielectric. */
function centred(w: number, b: number, t: number, er: number = 1): CrossSection {
  return {
    conductors: [{ id: 's', xMm: 0, zMm: (b - t) / 2, widthMm: w, thicknessMm: t }],
    planes: [{ zMm: 0 }, { zMm: b }],
    dielectrics: er > 1 ? [{ zMm: 0, thicknessMm: b, er, lossTangent: 0 }] : [],
  }
}

/** Small Gauss–Jordan inverse, independent of the solver's factorization. */
function invert(matrix: Matrix): Matrix {
  const n = matrix.length
  const a = matrix.map((row, i) => [...row, ...row.map((_, j) => Number(i === j))])
  for (let k = 0; k < n; k++) {
    const pivot = a.slice(k).reduce((best, row, i) => Math.abs(row[k]) > Math.abs(a[best][k]) ? k + i : best, k)
    const swap = a[k]
    a[k] = a[pivot]
    a[pivot] = swap
    const scale = a[k][k]
    a[k] = a[k].map(value => value / scale)
    for (let i = 0; i < n; i++) if (i !== k) {
      const factor = a[i][k]
      a[i] = a[i].map((value, j) => value - factor * a[k][j])
    }
  }
  return a.map(row => row.slice(n))
}

/** Surface resistance divided by sqrt(f): Rs = rho/delta = sqrt(pi f mu0 / sigma), delta = sqrt(rho/(pi f mu0)). */
const surface = (conductivity: number): number => Math.sqrt(Math.PI * mu0 / conductivity)

/** Solver C error against Cohn's exact zero-thickness stripline, per panels-per-edge count (t/b = 5e-4, er = 4). */
function cohnErrors(ratio: number, panels: number[]): Map<number, number> {
  const exact = stripline(ratio, 1, 4)
  return new Map(panels.map(count => [count, Math.abs(solveSectionCapacitance(centred(ratio, 1, 5e-4, 4), { panelsPerEdge: count })[0][0] / exact.capacitance - 1)]))
}

test('golden stage 3: Cohn exact stripline C and Z0 over w/b', () => {
  // Reference: Cohn (1954) exact conformal map, Z0 = eta0/(4 sqrt(er)) K(k)/K(k'), k = sech(pi w/2b)
  // (cross-section-reference.ts). The solver needs t > 0: t/b = 5e-4 raises C slightly (Cohn's thick-strip
  // fringing term). Tolerances: 1% at the default 12 panels/edge, the solver's own claimed mesh convergence
  // (12 -> 16 change < 1%, asserted above); 0.5% at 24 panels. The region is homogeneous: no interface truncation.
  const rows: Record<string, number>[] = []
  const failures: string[] = []
  for (const ratio of [.25, .5, 1, 2, 4]) {
    const exact = stripline(ratio, 1, 4)
    const errors = cohnErrors(ratio, [6, 8, 12, 16, 24])
    const line = solveCrossSection(centred(ratio, 1, 5e-4, 4))
    const zError = Math.abs(Math.sqrt(line.L[0][0] / line.C[0][0]) / exact.z - 1)
    rows.push({ wOverB: ratio, exactZ0: +exact.z.toFixed(3), z0ErrorPercent: +(100 * zError).toFixed(4), ...Object.fromEntries([...errors].map(([panels, value]) => [`cErrorPercent@${panels}`, +(100 * value).toFixed(4)])) })
    if (!(errors.get(12)! <= .01)) failures.push(`w/b ${ratio}: C error ${errors.get(12)} at 12 panels > 1%`)
    if (!(zError <= .01)) failures.push(`w/b ${ratio}: Z0 error ${zError} > 1%`)
    if (!(errors.get(24)! <= .005)) failures.push(`w/b ${ratio}: C error ${errors.get(24)} at 24 panels > 0.5%`)
  }
  console.table(rows)
  assert.deepEqual(failures, [])
})

test('golden stage 3: Cohn stripline error shrinks from 6 to 24 panels per edge', { todo: 'FAILS as declared. Measured |C/C_cohn - 1| at w/b 0.25: 0.023% (6), 0.163% (8), 0.233% (12), 0.250% (16), 0.259% (24): it rises to a plateau instead of shrinking, and 0.259% exceeds the a-priori 0.2% thickness floor. Every w/b behaves the same way (plateaus 0.26/0.18/0.13/0.10/0.07% for w/b 0.25..4). Post-hoc reading: the plateau is the t/b = 5e-4 thickness bias (Cohn thick-strip estimate ~0.24% at w/b 0.25), so the a-priori floor was too low; not re-fitted.' }, () => {
  // Same reference as above. Declared trend: the 24-panel error must not exceed the 6-panel error, unless both are
  // under the 0.2% floor attributed in advance to the t/b = 5e-4 thickness.
  const failures = [.25, .5, 1, 2, 4].flatMap(ratio => {
    const errors = cohnErrors(ratio, [6, 24])
    return errors.get(24)! <= Math.max(errors.get(6)!, .002) ? [] : [`w/b ${ratio}: ${errors.get(6)} (6) -> ${errors.get(24)} (24)`]
  })
  assert.deepEqual(failures, [])
})

/** Solver C / parallel-plate C and Cohn's exact ratio for a strip of width ratio*b (b = 1 mm, t = 5e-4 mm, er 4). */
function parallelPlate(ratio: number): { solved: number; exact: number } {
  return {
    solved: solveSectionCapacitance(centred(ratio, 1, 5e-4, 4))[0][0] / (4 * epsilon0 * 4 * ratio / (1 - 5e-4)),
    exact: stripline(ratio, 1, 4).capacitance / (4 * epsilon0 * 4 * ratio),
  }
}

// A wide strip between planes is two parallel-plate capacitors, C_pp = eps w/d each with d = (b - t)/2.
// The exact excess (fringing) follows from Cohn's formula: C/C_pp -> 1 + (8 ln2/pi)/(4 w/b), i.e. 2.2% at w/b = 20.
// Declared checks: the solver ratio tracks Cohn's exact ratio within the same 1% mesh tolerance, decreases
// monotonically as w/b grows, and is within 3% of the parallel-plate value at w/b = 20.
test('golden stage 3: parallel-plate trend C/C_pp -> 1 for w/b = 2, 5, 10', () => {
  const rows = [2, 5, 10].map(ratio => ({ wOverB: ratio, ...parallelPlate(ratio) }))
  console.table(rows)
  assert.ok(rows.every(row => Math.abs(row.solved / row.exact - 1) <= .01), 'tracks Cohn within 1%')
  assert.ok(rows.every((row, i) => !i || row.solved < rows[i - 1].solved), 'decreases monotonically')
})

test('golden stage 3: parallel-plate limit at w/b = 20', () => {
  const wide = parallelPlate(20)
  assert.ok(Math.abs(wide.solved / wide.exact - 1) <= .01, `tracks Cohn within 1%: ${wide.solved} vs ${wide.exact}`)
  assert.ok(wide.solved < parallelPlate(10).solved, 'decreases monotonically from w/b = 10')
  assert.ok(Math.abs(wide.solved - 1) <= .03, `within 3% of C_pp: ${wide.solved}`)
})

test('golden stage 3: homogeneous dielectric gives L C = mu0 eps0 er I for coupled lines (v = c/sqrt(er))', () => {
  // Quasi-TEM in one homogeneous medium: L C = mu eps I exactly, for any geometry (Paul, Analysis of Multiconductor
  // Transmission Lines, 2nd ed., section 3.2). Here L comes from the vacuum solve, so the identity also guards the
  // dielectric/vacuum plumbing; tolerance 1e-9 relative (floating point only).
  const cases: { label: string; er: number; section: CrossSection }[] = [
    { label: 'stripline, 3 coupled lines, er 4', er: 4, section: { conductors: [-.5, 0, .5].map((x, i) => ({ id: `s${i}`, xMm: x, zMm: .4825, widthMm: .3, thicknessMm: .035 })), planes: [{ zMm: 0 }, { zMm: 1 }], dielectrics: [{ zMm: 0, thicknessMm: 1, er: 4, lossTangent: 0 }] } },
    { label: 'air microstrip pair', er: 1, section: { conductors: [-.75, .75].map((x, i) => ({ id: `m${i}`, xMm: x, zMm: 1, widthMm: 1, thicknessMm: .035 })), planes: [{ zMm: 0 }], dielectrics: [] } },
  ]
  const failures: string[] = []
  for (const { label, er, section } of cases) {
    const line = solveCrossSection(section)
    const target = mu0 * epsilon0 * er
    const product = line.L.map(row => line.C[0].map((_, j) => row.reduce((sum, value, k) => sum + value * line.C[k][j], 0)))
    const worst = Math.max(...product.flatMap((row, i) => row.map((value, j) => Math.abs(value - (i === j ? target : 0)) / target)))
    console.log(`${label}: max |LC - mu eps er I| / (mu eps er) = ${worst.toExponential(3)}; modal velocity / (c/sqrt(er)) = ${(1 / Math.sqrt(product[0][0]) / (1 / Math.sqrt(target))).toFixed(12)}`)
    if (!(worst <= 1e-9)) failures.push(`${label}: ${worst}`)
  }
  assert.deepEqual(failures, [])
})

test('golden stage 3: DC resistance R = rho l / A and its low-frequency limit', () => {
  // R per metre = 1/(sigma w t) exactly; infinite planes carry no DC resistance in this model. At 1 kHz the skin
  // depth (2 mm in copper) is ~60x the thickness, so true R(f)/R_dc - 1 ~ (t/delta)^4 << 1e-3 (Ramo, Whinnery & Van Duzer,
  // Fields and Waves, section 5.6): tolerance 1e-3 at 1 kHz, exact equality at f = 0, 1e-12 relative for R_dc.
  const section: CrossSection = {
    conductors: [{ id: 'cu', xMm: -.3, zMm: .4825, widthMm: .2, thicknessMm: .035 }, { id: 'alloy', xMm: .3, zMm: .491, widthMm: .15, thicknessMm: .018, conductivitySm: 3.5e7 }],
    planes: [{ zMm: 0 }, { zMm: 1 }], dielectrics: [{ zMm: 0, thicknessMm: 1, er: 4, lossTangent: .01 }],
  }
  const line = solveCrossSection(section)
  const expected = section.conductors.map(c => 1 / ((c.conductivitySm ?? copper) * c.widthMm * 1e-3 * c.thicknessMm * 1e-3))
  const failures: string[] = []
  for (const [i, value] of expected.entries()) {
    if (!(Math.abs(line.dcResistance[i][i] / value - 1) <= 1e-12)) failures.push(`R_dc ${i}: ${line.dcResistance[i][i]} vs ${value}`)
    const low = line.atFrequency(1e3).R[i][i] / value - 1
    console.log(`conductor ${i}: R_dc ${value.toFixed(6)} ohm/m; R(1 kHz)/R_dc - 1 = ${low.toExponential(3)}`)
    if (!(low >= 0 && low <= 1e-3)) failures.push(`R(1 kHz) ${i}: relative excess ${low}`)
  }
  if (line.dcResistance[0][1] !== 0 || line.dcResistance[1][0] !== 0) failures.push('ideal planes must not couple DC resistance')
  assert.deepEqual(line.atFrequency(0).R, line.dcResistance)
  assert.deepEqual(failures, [])
})

// High-frequency conductor loss. Wheeler, "Formulas for the skin effect", Proc. IRE 30 (1942) 412–424:
// R = (Rs/mu0) dL/dn with every wall receded by n, Rs = sqrt(pi f mu0/sigma) = rho/delta. Each check has its own
// a-priori tolerance, stated beside it.
test('golden stage 3: R(f) scales as sqrt(f) once delta << t', () => {
  // (a) exponent d ln R/d ln f between 10 and 40 GHz within [0.49, 0.5]: delta = 0.66 um << t = 35 um there.
  const rows = [.5, 1, 2].map(ratio => {
    const line = solveCrossSection(centred(ratio, 1, .035))
    return { wOverB: ratio, exponent: Math.log(line.atFrequency(4e10).R[0][0] / line.atFrequency(1e10).R[0][0]) / Math.log(4) }
  })
  console.table(rows)
  assert.ok(rows.every(row => row.exponent >= .49 && row.exponent <= .5 + 1e-9))
})

test('golden stage 3: skin resistance equals Wheeler\'s rule recomputed independently', () => {
  // (b) Wheeler's rule recomputed here: own recession (planes move away, strips shrink), own step 5e-4 mm vs the
  // solver's ~1.75e-4 mm, from the solver's vacuum L = mu0 eps0 C0^-1. Within 1%: both are central differences of
  // the same smooth L(n), so a larger gap would be a units, constant or wall-direction error.
  const pair: CrossSection = { conductors: [-.375, .375].map((x, i) => ({ id: `m${i}`, xMm: x, zMm: .5, widthMm: .5, thicknessMm: .035 })), planes: [{ zMm: 0 }], dielectrics: [{ zMm: 0, thicknessMm: .5, er: 4, lossTangent: 0 }] }
  const failures: string[] = []
  for (const [label, section] of [['stripline w/b 1', centred(1, 1, .035)], ['microstrip pair', pair]] as const) {
    const step = 5e-4
    /** Vacuum L = mu0 eps0 C0^-1 with every copper wall receded by n mm. */
    const receded = (n: number): Matrix => invert(solveSectionCapacitance({ dielectrics: [], planes: section.planes.map(p => ({ zMm: p.zMm < section.conductors[0].zMm ? p.zMm - n : p.zMm + n })),
      conductors: section.conductors.map(c => ({ ...c, zMm: c.zMm + n, widthMm: c.widthMm - 2 * n, thicknessMm: c.thicknessMm - 2 * n })) })).map(row => row.map(value => mu0 * epsilon0 * value))
    const plus = receded(step)
    const minus = receded(-step)
    const solved = solveCrossSection(section).skinResistance
    const worst = Math.max(...solved.flatMap((row, i) => row.map((value, j) => Math.abs(surface(copper) / mu0 * (plus[i][j] - minus[i][j]) / (2 * step * 1e-3) / value - 1))))
    console.log(`${label}: worst |R_wheeler / R_solver - 1| = ${worst.toExponential(3)}`)
    if (!(worst <= .01)) failures.push(`${label}: ${worst}`)
  }
  assert.deepEqual(failures, [])
})

test('golden stage 3: wide stripline skin resistance approaches Rs/w', () => {
  // (c) Wide stripline limit R -> Rs/w (strip faces and both planes each carry half the current; Ramo, Whinnery &
  // Van Duzer, Fields and Waves, section 8.3). r = R w/Rs; Richardson 2 r(40) - r(20) within 2% of 1, r(20) > r(40) > 1,
  // at the default and at 24 panels/edge.
  for (const panels of [12, 24]) {
    const [r20, r40] = [20, 40].map(w => solveCrossSection(centred(w, 1, .035), { panelsPerEdge: panels }).skinResistance[0][0] * w * 1e-3 / surface(copper))
    assert.ok(Math.abs(2 * r40 - r20 - 1) <= .02 && r20 > r40 && r40 > 1, `${panels} panels: r20 ${r20}, r40 ${r40}`)
  }
})

test('golden stage 3: stripline skin resistance agrees with Pozar\'s Wheeler-derived closed form', { todo: 'FAILS as declared. Measured solver/Pozar = 0.855, 0.866, 0.886 at w/b = 0.5, 1, 2 (t/b = 0.035), outside 10%. Post-hoc diagnostics: the solver value is mesh-converged (0.03% change 12 -> 48 panels at w/b 1); Pozar uses the zero-thickness Z0 (65.4 ohm vs solver 61.3 ohm at w/b 1), and R ~ Z0^2 accounts for ~12%. Unresolved, not re-fitted.' }, () => {
  // (d) Pozar's Wheeler-derived closed form (cross-section-reference.ts) at w/b = 0.5, 1, 2: within 10% (a curve fit).
  for (const ratio of [.5, 1, 2]) {
    const solved = solveCrossSection(centred(ratio, 1, .035)).skinResistance[0][0]
    const pozar = pozarStriplineResistance(ratio * 1e-3, 1e-3, .035e-3, 1, surface(copper))
    assert.ok(Math.abs(solved / pozar - 1) <= .1, `w/b ${ratio}: solver/Pozar ${solved / pozar}`)
  }
})

test('golden invariants: extracted L, C0, C are SPD with |k| < 1, C is Maxwell, R(f) and G(f) are PSD', () => {
  // Passive reciprocal multiconductor lines (Paul, MTL 2nd ed., sections 3.2–3.4): L, C symmetric positive
  // definite, every pairwise |k| < 1; grounded Maxwell C has positive diagonal, negative off-diagonal entries and
  // non-negative row sums (capacitance to the references). Loss matrices R(f), G(f) are PSD. Tolerances are
  // floating point only: asymmetry 1e-12, row sums >= -1e-9 C_ii, PSD eigenvalues >= -1e-12 of the largest.
  const sections: { label: string; section: CrossSection }[] = [
    ...(['microstrip', 'stripline', 'mask'] as const).flatMap(kind => [1, 2, 12].map(count => ({ label: `${kind} ${count}`, section: sectionFixture(kind, count) }))),
    { label: 'centred stripline w/b 1', section: centred(1, 1, .035, 4) },
  ]
  const rows: Record<string, number | string>[] = []
  const failures: string[] = []
  for (const { label, section } of sections) {
    const line = solveCrossSection(section)
    let minimum = Infinity
    let coupling = 0
    for (const [name, matrix] of [['L', line.L], ['C0', line.C0], ['C', line.C]] as const) {
      const facts = energyFacts(matrix)
      minimum = Math.min(minimum, facts.minimumEigenvalue / facts.maximumEigenvalue)
      coupling = Math.max(coupling, facts.coupling)
      if (!(facts.asymmetry <= 1e-12 && facts.minimumEigenvalue > 0 && facts.coupling < 1)) failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    for (const name of ['C', 'C0'] as const) {
      const facts = maxwellFacts(line[name])
      if (!(facts.minimumDiagonal > 0 && facts.maximumOffDiagonal < (section.conductors.length > 1 ? 0 : 1) && facts.minimumRowSum >= -1e-9)) failures.push(`${label} ${name} Maxwell: ${JSON.stringify(facts)}`)
    }
    for (const frequency of [0, 1e6, 1e9, 1e10]) for (const [name, matrix] of Object.entries(line.atFrequency(frequency))) {
      const facts = energyFacts(matrix)
      if (!(matrix.every((row, i) => row[i] >= 0) && facts.minimumEigenvalue >= -1e-12 * Math.abs(facts.maximumEigenvalue))) failures.push(`${label} ${name}(${frequency}): ${JSON.stringify(facts)}`)
    }
    rows.push({ section: label, smallestEigenvalueRatio: +minimum.toExponential(3), largestCouplingK: +coupling.toFixed(4) })
  }
  console.table(rows)
  assert.deepEqual(failures, [])
})
