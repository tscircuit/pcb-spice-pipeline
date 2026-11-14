# Golden known-answer checks

Each check compares the routed 2.5D pipeline with an answer that is fixed in advance by exact
physics, a hard invariant or the vendor's own data. The expected value and the tolerance were
written into the test, with the source cited beside it, **before** the pipeline ran. A failing
check is never loosened and no solver code was changed to pass one. A failing check is marked `todo`
with its measured value and listed under findings. A "post-hoc" note is an explanation found after
the failure. It is not a re-fitted check.

Only routed 2.5D modules are exercised: `cross-section`, `causal-loss`, `route-fields-solver`,
`route-ladder`, `package-model`/`package-matrix`/`coupled-package` and `switching`. The checks
live in the test file of the module they exercise. Shared measuring helpers are in
`tests/support/golden-checks.ts`.

```sh
# Always-on checks (no native tools, no vendor files)
node --import tsx --test --test-concurrency=1 'tests/**/*.test.ts' 'tests/**/*.test.tsx'
# Vendor package checks: local, never-committed IBIS files
IBIS_MODEL_DIR=/path/to/models node --import tsx --test tests/buffers/package-matrix.test.ts tests/buffers/coupled-package.test.tsx
# Native ngspice checks: small decks, one sequential ngspice at a time (OMP_NUM_THREADS=1)
SI_NATIVE_TESTS=1 IBIS_MODEL_DIR=/path/to/models node --import tsx --test tests/simulation/route-ladder.test.tsx tests/buffers/switching.test.tsx
```

Native checks skip without `SI_NATIVE_TESTS=1` or without `ngspice` on `PATH`. Vendor checks
skip without `IBIS_MODEL_DIR` or without the named file (`sprm552c.ibs`, `W631GG6MB-12.ibs`).

## Results

Measured on 2026-11-14. Cross-sections use b = 1 mm and copper unless stated otherwise.

| # | Check | Reference | Expected / tolerance (fixed in advance) | Measured | Status |
|---|---|---|---|---|---|
| 1 | Coaxial line Z0 = 60/√εr ln(b/a) | — | Not representable: the solver takes rectangles between infinite horizontal planes, so it has no closed outer conductor, no round conductor and no side walls for a square coax. Check 2 (Cohn) is the closest exact shielded geometry. | — | n/a |
| 2 | Stripline C and Z0, w/b = 0.25, 0.5, 1, 2, 4 (t/b = 5e-4, εr 4) | Cohn 1954 exact: Z0 = η0/(4√εr)·K(k)/K(k′), k = sech(πw/2b) | C ≤ 1% at the default 12 panels/edge; C ≤ 0.5% at 24; Z0 ≤ 1% | C error 0.23 / 0.15 / 0.09 / 0.06 / 0.05% at 12; ≤ 0.26% at 24; Z0 ≤ 0.23% | pass |
| 3 | Stripline mesh trend, 6 → 24 panels | same | 24-panel error ≤ max(6-panel error, 0.2% thickness floor) | w/b 0.25: 0.023 → 0.163 → 0.233 → 0.250 → 0.259%. The error rises to a plateau. | **todo** |
| 4 | Parallel-plate trend, w/b = 2, 5, 10 | C_pp = 4εw/(b − t); exact fringe from Cohn | C/C_pp within 1% of Cohn's ratio; decreasing | 1.2208 / 1.0882 / 1.0450 vs 1.2206 / 1.0883 / 1.0441 | pass |
| 5 | Parallel-plate limit, w/b = 20 | same | within 1% of Cohn (1.0221); below w/b = 10; within 3% of C_pp | 1.0633 (C 4.0% high); trend reverses | **todo** |
| 6 | Homogeneous L·C = μ0ε0εr·I (3-line stripline εr 4; air microstrip pair) | Paul, *MTL* §3.2 | ≤ 1e-9 relative | 1.4e-16, 2.8e-16 | pass |
| 7 | DC resistance R = 1/(σwt), and R(1 kHz) | Ohm's law; δ(1 kHz) ≈ 2 mm ≫ t | R_dc exact to 1e-12; R(1 kHz)/R_dc − 1 ≤ 1e-3 | exact; 6.5e-5, 1.2e-5 | pass |
| 8 | R ∝ √f, exponent from 10 to 40 GHz (w/b 0.5, 1, 2; t = 35 µm) | skin effect, δ ≪ t | exponent in [0.49, 0.5] | 0.49987 / 0.49990 / 0.49991 | pass |
| 9 | Skin R equals Wheeler's rule, recomputed in the test (own recession and step) | Wheeler 1942: R = (Rs/μ0)·dL/dn | ≤ 1% | 1.4e-5 (stripline), 4.9e-5 (microstrip pair, full 2×2) | pass |
| 10 | Wide stripline R → Rs/w (w = 20, 40 mm) | Ramo, Whinnery & Van Duzer §8.3 | Richardson 2r(40) − r(20) within 2% of 1; r(20) > r(40) > 1; at 12 and at 24 panels | 12 panels: r = 1.078, 1.853 (limit 2.63); 24 panels: r = 1.012, 1.081 (r40 > r20) | **todo** |
| 11 | Stripline skin R against Pozar's Wheeler-derived formula (w/b 0.5, 1, 2; t/b 0.035) | Pozar, *Microwave Engineering* 4th ed. §3.7 | within 10% (a curve fit) | solver/Pozar = 0.855 / 0.866 / 0.886 | **todo** |
| 12 | Causal-loss poles are stable and passive | Guillemin, Foster positive-real form | all poles −rate < 0; all elements > 0; Re Z, Re Y ≥ 0 from 1 Hz to 1 THz | holds | pass |
| 13 | Skin phase X/R = 1 (Zs = (1 + j)Rs), 10 MHz – 5 GHz | Ramo, Whinnery & Van Duzer §5.4 | ≤ 5% | worst 7.2% (1.85 GHz) | **todo** |
| 14 | Dielectric Kramers–Kronig: dC/d ln ω = −(2/π)·G/ω, 10 MHz – 5 GHz | Djordjevic et al., IEEE T-EMC 2001 | ≤ 5% locally | worst 18.5% (30.6 MHz) | **todo** |
| 15 | Fixture sections (microstrip, mask, stripline × 1, 2, 12 conductors): L, C0, C SPD, \|k\| < 1; C Maxwell; R(f), G(f) PSD | Paul, *MTL* §3.2–3.4 | floating point only | holds; min λ/λmax 0.297; max k 0.298 | pass |
| 16 | Routed TSX sections (`routedCopper`, `TwoTraceBoard`): same invariants | same | floating point only | holds; max k 0.501 | pass |
| 17 | AM335x package, all 175 pins: L, C SPD, \|k\| < 1, C Maxwell, R PSD | IBIS [Define Package Model]; passivity | λmin > 0, k < 1 | L λmin 1.19 nH (λmax 43.9 nH), k 0.627 (P1/P2); C λmin 0.307 pF, k 0.545; 30,450 raw C off-diagonals positive | pass |
| 18 | AM335x DDR3 selections (24 addr/cmd, 11 DQ write) after `coupledPackage`, plus emitted K | Schur reduction keeps definiteness | λmin > 0, k < 1, K < 1 | addr/cmd: L λmin 1.71 nH, k 0.623 (C2/C1); DQ: L λmin 1.57 nH, k 0.627 | pass |
| 19 | Winbond W631GG6MB-12 package | scalar passivity | no coupled model; every [Pin] R, L, C ≥ 0 | 144 scalars, all ≥ 0 | pass |
| 20 | Ladder conserves Σ L, Σ R, Σ C and K = L12/√(L11L22) | Paul, *MTL* §7.1 | ≤ 1e-9 relative | holds (67 and 146 cells) | pass |
| 21 | Matched line: delay l√εr/c and no near-end reflection (100 mm, homogeneous εr 4) | Pozar §2.3 | delay within 1%; near end within 2% of 0.5 V | 668.05 vs 667.13 ps (+0.14%); 0.8 mV | pass |
| 22 | Matched line: far end flat after the edge | same | within 2% of 0.5 V | 14.3 mV (2.9%), 66 ps after the edge | **todo** |
| 23 | Open end and Γs = −½: lattice plateaus and bounce times (k = 0..3) | Johnson & Graham §4.3 (Bergeron) | plateaus within 2% of the 1 V swing; steps within 1% of the ideal time | plateaus ≤ 2.9 mV off; steps ≤ 0.30% late | pass |
| 24 | Coupled microstrip pair: even and odd delays from L, C | Paul, *MTL* §5.2 | each within 1% | even −0.20%, odd −0.29% (583 vs 524 ps predicted) | pass |
| 25 | Settled (DC) voltage = divider including R_dc·l (ngspice `.op`) | Ohm's law | ≤ 1e-5 V | 1e-10 V | pass |
| 26 | Vendor buffers into their own IBIS fixtures (Model_336/352/343, DATA_34/40; both edges, both 50 Ω fixtures) | the vendor [Rising/Falling Waveform] tables | max \|ΔV\| ≤ 2% of swing; \|Δt50\| ≤ 10 ps | 20 replays: ≤ 0.60% of swing, ≤ 0.80 ps | pass |

## Findings

| Finding | Evidence | Post-hoc reading (not a check) |
|---|---|---|
| The default 12-panel mesh under-resolves wide conductors | #5: C 4% high at w/b = 20; #10: r(20) = 1.078 against 1.008 at 48 panels, and r(40) = 1.85 against a limit near 1 | Accuracy improves with panels: 48 panels reach Cohn's value within 0.007%. Panel count per edge is fixed whatever the aspect ratio. At DDR-like w/b = 0.5–2, C is within 0.15% of Cohn, and at w/b = 1 skin R changes 0.03% from 12 to 48 panels. |
| Skin R sits 11–14% below Pozar's closed form | #11 | The solver value is mesh-converged and matches Wheeler's rule (#9). Pozar uses the zero-thickness Z0 (65.4 Ω vs 61.3 Ω at w/b 1), and R ∝ Z0² accounts for ~12%. Unresolved. |
| Causal-loss ripple | #13 (7.2% phase), #14 (18.5% local slope) | One pole per decade. Averaged over a decade, the dielectric slope equals −2/π within 2.5e-7, so causality holds on average. |
| Ladder dispersion ringing | #22 | It decays to 3.6 mV within the next 100 ps and falls to 5.0 mV at 20 cells per rise. The near end shows 0.8 mV, so it is not a reflection. |
| Stripline trend criterion | #3 | The error plateaus at the t/b = 5e-4 thickness bias, which Cohn's thick-strip formula estimates at ~0.24% for w/b 0.25. The a-priori 0.2% floor was too low. |
| Vendor AM335x package passes, but its raw C is not Maxwell | #17 | All 30,450 off-diagonals are positive as written. The matrix is SPD and Maxwell only after the repo's documented sign correction. Summed \|mutual L\| per pin is 17–62 nH against 2.1–6.4 nH self, yet L is positive definite with k ≤ 0.627. |
| The IBIS replay is a round trip | #26 | The converter derives its coefficients from these same two tables per edge, so #26 checks the converter and its SPICE realization, not the two-waveform method's accuracy into other loads. The vendor files carry no third, independent fixture. |
