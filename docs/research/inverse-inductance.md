# Inverse-inductance (susceptance) realization of the routed ladder

Research spike on `fix/routed-ddr3-level4` (#75, head `329a32c`). Question: does replacing the coupled
inductors and K lines of the routed DDR3 ladder by a sparsified inverse-inductance matrix K = L⁻¹
make the level-4 transient fast enough, while staying accurate and passive?

**Verdict: no.** Susceptance does not make the DDR3 level-4 transient fast enough, and it is not the right
sparsification for this ladder.

- The premise behind sparsified susceptance (Devgan/Ji/Dai, ICCAD 2000; VPEC; window sparsification) is that partial
  inductance L is dense and slow-decaying while L⁻¹ is local. The routed ladder L is not a PEEC partial-inductance
  matrix. It is a 2D quasi-TEM assembly: cells couple only laterally, inside a shared cross-section slice, with no
  longitudinal partial mutuals. It is already sparse (3,672 pairs for 1,835 cells) and strictly diagonally dominant
  (0.952), so truncating L itself is provably positive definite. L⁻¹ fills in 17.5 times along overlapping cell
  chains. At equal thresholds, K keeps as many pairs or more, with a larger effective-L error, and each K pair stamps
  4 matrix entries against 2 for a K line.
- **Measured.** The exact inverse reproduces the K-line waveforms: 2e-5 mV on two-trace and 0.11 mV on differential.
  It is 44% slower on two-trace. On DDR at t = 1e-3 (1.05e-3 worst relative effective-L error), the edge window runs
  at the same 14 s/point as K lines: 43 against 42 points in 600 s. Neither run reaches a receiver within the
  10-minute bound; a 1 ns edge window needs at least 20 minutes.
- **What actually costs** is KLU fill-in: 23.8M fill entries on 0.73M at the operating point. Dropping weak couplings
  is where the leverage is, and plain L-space truncation is the better tool for it. At 1e-2 it removes 58% of the op
  fill and makes transient factorization 1.47 times faster per iteration, matching the baseline within 4.5e-8 mV over
  1 ps. The start of this deck's transient is fragile, though: the baseline stalls when only tstop changes, and
  `k0.01` diverges for tstop 0.5 and 1.05 ns. That must be resolved before any sparsification can be qualified.

## Realization chosen and why

ngspice has no susceptance element. The cheapest passive form is one flux node per coupled cell:

| Element per cell i | SPICE | Role |
|---|---|---|
| flux capacitor | `C<tag>F<i> <tag>f<i> 0 L(i,i)` | integrates the cell voltage: f(i) = flux(i) / L(i,i) |
| integrator feed | `G<tag>F<i> 0 <tag>f<i> before after 1` | injects the cell voltage into the flux node |
| cell current | `G<tag>_<i>_<j> before after <tag>f<j> 0 K(i,j)·L(j,j)` | I(i) = Σ K(i,j) flux(j), once per kept j (including i) |

A cell that keeps no coupling becomes one plain inductor of 1/K(i,i). The stored energy is ½ fluxᵀ K flux. It is
passive exactly when the kept K is symmetric positive definite. `susceptanceEnergy` checks that with a
Cholesky factorization of every truncated block and throws otherwise. Truncation uses
|K(i,j)| > t·√(K(i,i)K(j,j)), which is symmetric. DC is well posed: each flux row forces the cell voltage to
zero, and the flux values carry the currents. The capacitor charge equals the inductor flux, so ngspice
controls truncation error on the same quantity as for an inductor.

Rejected realizations:

| Alternative | Why not |
|---|---|
| Gyrator per cell plus an x-side network | A gyrator maps a capacitance matrix C to inductance C/g². To realize I = K∫V, the x-side needs C = g²L, which is dense again. |
| Maxwell inductor network of K plus ideal transformers (E/V/F) | Every K term becomes an inductor branch, and each cell adds an E, a V and an F. That is more unknowns and entries than K lines. |
| Per-cluster inverse of truncated K, back to coupled inductors | Block-diagonal truncation, equivalent to coupling-group splitting (#79, negative). |

MNA cost of the inductive part, per coupled layer:

| Form | Unknowns per cell | Entries per cell | Entries per coupled pair |
|---|---|---|---|
| Coupled inductors and K lines | 1 branch current | 5 | 2 |
| Flux-node susceptance | 1 flux node | 5 | 4 |

The opt-in prototype is `RoutedCompileOptions.susceptanceThreshold`. It applies to the main ladder L (`ARCL`)
and to the nine skin-pole inductor layers (`ARCP0..8`), which share the skin-resistance coupling pattern.
The default deck is unchanged.

## DDR3 matrices (level-4 addr/cmd scope)

The deck has 1,835 cells and 36,814 K lines. Of these, 3,672 couple the main `ARCL` layer, 9 × 3,612–3,686
couple the skin-pole layers, and 276 belong to the IBIS package model. L splits into 882 disconnected components;
the largest has 257 cells. The median |k| is 1.06e-3, the minimum 3.1e-15 and the maximum 0.431.

Diagonal dominance (largest Σ|L(i,j)|/L(i,i) over a row) is 0.952 for `ARCL` and 0.289 for every skin layer. L is
strictly diagonally dominant, so by Gershgorin any symmetric truncation of L itself stays positive definite.
The passivity argument for moving to K therefore does not apply here. The exact inverse has 64,328 structural pairs
in every layer, 17.5 times L. About half of its off-diagonal entries are positive, because cell orientation signs
are mixed.

`ARCL`, pairs kept at relative threshold t. The minimum eigenvalue is that of the diagonally scaled matrix, over all
882 components. The error is the worst max |L_eff(i,j) − L(i,j)| / √(L(i,i)L(j,j)), with L_eff = (K_t)⁻¹
for K-space truncation and L_eff = L_t for L-space truncation.

| t | L pairs | L min eig | L-space error | K pairs | K min eig | K-space error |
|---|---|---|---|---|---|---|
| 0 | 3,672 | 0.5264 | 0 | 64,328 | 0.4766 | 1.3e-15 |
| 1e-6 | 3,413 | 0.5264 | 9.3e-7 | 7,915 | 0.4766 | 1.1e-6 |
| 1e-4 | 2,792 | 0.5264 | 9.9e-5 | 3,752 | 0.4766 | 1.1e-4 |
| 1e-3 | 1,866 | 0.5264 | 1.0e-3 | 2,090 | 0.4766 | 1.05e-3 |
| 3e-3 | 1,370 | 0.5264 | 3.0e-3 | 1,468 | 0.4764 | 3.4e-3 |
| 1e-2 | 838 | 0.5262 | 9.9e-3 | 803 | 0.4758 | 1.53e-2 |
| 3e-2 | 398 | 0.5246 | 3.0e-2 | 389 | 0.4644 | 3.95e-2 |
| 1e-1 | 73 | 0.5195 | 9.9e-2 | 63 | 0.4501 | 0.113 |

Skin-pole layer `ARCP0`; `ARCP8` is identical up to its absolute 1e-24 H mutual cut:

| t | L pairs | L min eig | L-space error | K pairs | K min eig | K-space error |
|---|---|---|---|---|---|---|
| 0 | 3,686 | 0.8580 | 0 | 64,328 | 0.8123 | 1.8e-15 |
| 1e-3 | 1,874 | 0.8580 | 1.0e-3 | 1,930 | 0.8121 | 1.05e-3 |
| 1e-2 | 685 | 0.8578 | 1.0e-2 | 646 | 0.8128 | 1.12e-2 |
| 3e-2 | 189 | 0.8605 | 3.0e-2 | 182 | 0.8322 | 3.02e-2 |
| 1e-1 | 2 | 0.8715 | 9.2e-2 | 2 | 0.8760 | 9.2e-2 |

Every truncated K block stays positive definite at every threshold, so the realization is passive. L-space
truncation reaches the same pair count with a smaller error, and each pair costs half the matrix entries.

## Small-board parity (native ngspice-47, KLU, OMP_NUM_THREADS=1)

The examples are compiled through the TSX pipeline, then the network stage is re-run with `refinement: 4` and
`cellsPerRise: 40` so the ladder has nontrivial coupling. Each delta is the largest |ΔV| over all probes and all
reference timestamps, against the coupled-inductor deck (linear interpolation onto its time points). Analysis time
is ngspice's own CPU `Total analysis time`.

Two-trace (`examples/routed/two-trace-board.tsx`, 44 cells, 40 ns, 2,014 circuit equations in every variant).
The matrix counts come from ngspice `.options acct` and are deterministic. Times at this ~1 s scale vary by about
±15% between repeats on the shared machine; a first repeat measured 1.248 s for the reference and 1.870 s for the
exact inverse.

| Variant | K lines | G sources | Flux nodes | Matrix nnz | LU fill-in | Analysis s | Factor s | Max Δ mV |
|---|---|---|---|---|---|---|---|---|
| Coupled inductors (reference) | 220 | 1,188 | 0 | 7,750 | 6,417 | 0.909 | 0.380 | 0 |
| Susceptance t = 0 (exact) | 0 | 2,508 | 440 | 8,190 | 8,677 | 1.312 | 0.475 | 0.00002 |
| Susceptance t = 1e-3 | 0 | 2,508 | 440 | 8,190 | 8,677 | 1.294 | 0.463 | 0.00002 |
| Susceptance t = 1e-2 | 0 | 1,320 | 44 | 7,398 | 6,305 | 1.073 | 0.356 | 0.040 |
| Susceptance t = 1e-1 | 0 | 1,320 | 44 | 7,398 | 6,305 | 1.071 | 0.352 | 0.040 |
| L-space control k ≤ 1e-3 dropped | 220 | 1,188 | 0 | 7,750 | 6,417 | 0.901 | 0.383 | 0 |
| L-space control k ≤ 1e-2 dropped | 22 | 1,188 | 0 | 7,354 | 5,996 | 1.042 | 0.341 | 0.040 |

At t ≥ 1e-2, both truncations drop the skin-pole couplings (k = 0.008) and give the same 0.040 mV. The exact
susceptance deck has 19% more matrix entries after fill-in (16,867 against 14,167) and is about 44% slower. The
truncated susceptance deck has 3% fewer entries than the reference. The L-space control at the same accuracy has
6% fewer.

Differential (`examples/level1-differential`, 4 cells even at maximum refinement, because the slow RS-485 edge
bounds the cell length; 576 µs):

| Variant | K lines | G sources | Flux nodes | Points | Analysis s | Max Δ mV |
|---|---|---|---|---|---|---|
| Coupled inductors (reference) | 10 | 54 | 0 | 278,849 | 50.6 | 0 |
| Susceptance t = 0 (exact) | 0 | 114 | 20 | 278,878 | 42.7 | 0.113 |
| Susceptance t = 1e-3 | 0 | 114 | 20 | 278,878 | 37.5 | 0.113 |
| Susceptance t = 1e-2 | 0 | 114 | 20 | 278,878 | 47.6 | 0.113 |
| Susceptance t = 1e-1 | 0 | 60 | 2 | 278,913 | 47.6 | 0.086 |

The exact inverse reproduces the coupled-inductor waveforms: 2e-5 mV on two-trace, and 0.11 mV over 278k
differential points, which is time-grid interpolation on the edges. On the coupled two-trace board the susceptance
deck is 18–50% slower across two repeats. The differential timings differ by less than run-to-run noise on this
shared machine.

## DDR3 bounded windows

Every DDR run is one ngspice process behind the shared machine lock, with OMP_NUM_THREADS=1 and a 600 s wall bound.
The deck is the real board's addr/cmd scope (1,835 cells, 24 receiver probes, 12.3 ps maximum step). The table counts
are deck lines; `K lines` includes the 276 package-model K lines, which every variant keeps.

| Variant | K lines | G sources | Flux nodes | Coupled-inductor and flux unknowns |
|---|---|---|---|---|
| Coupled inductors `k` | 36,814 | 85,178 | 0 | 18,503 inductors |
| Susceptance t = 1e-3 | 276 | 143,506 | 9,704 | 8,799 inductors + 9,704 flux nodes |
| Susceptance t = 1e-2 | 276 | 112,196 | 6,892 | 11,611 inductors + 6,892 flux nodes |
| L-space control `k0.01` | 7,279 | 85,178 | 0 | 18,503 inductors |

**Quiet window, 0 to 0.5 ns.** The stimulus first changes at 2.5 ns, so the window is a DC hold.

| Variant | Points | Reached | ngspice wall s | s/point | Max Δ mV | Outcome |
|---|---|---|---|---|---|---|
| `k` | 53 | 0.500 ns | 518.8 (516.3 CPU) | 9.79 | 0 | completed |
| Susceptance 1e-3 | 36 | 0.333 ns | 600 (bound) | 16.7 | 0.0002 | bounded |
| Susceptance 1e-2 | 6 | 0.0008 ns | 1,620 (see note) | 270 | — | stalls near 1.6 ps |
| `k0.01` | 243 | 9e-6 ns | 600 (bound) | — | diverged | 8e31 V on probe node n522 from t = 6 fs |

The first two rows ran consecutively at 11:04 and 11:17, while another agent's process kept the load average near 25 on
10 cores. Machine load may account for the 1.7× gap. A back-to-back repeat at
0.3 ns did not settle it: the baseline stalled (see below), and the susceptance repeat was cut off after 16 points
when its job hit the background time limit. The edge rows are the controlled speed comparison.

**Edge window.** Every PWL source is shifted 2.45 ns earlier, giving 50 ps of DC hold and then the first transition.
1.05 ns was requested. All three runs went back to back at a load average near 3.

| Variant | Points | Reached | ngspice wall s | s/point | Max Δ mV | Outcome |
|---|---|---|---|---|---|---|
| `k` | 42 | 164 ps | 600 (bound) | 14.3 | 0 | bounded |
| Susceptance 1e-3 | 43 | 165 ps | 600 (bound) | 13.95 | 3e-6 | bounded |
| `k0.01` | 78 | 1.06 ps | 600 (bound) | — | diverged | 4e22 V on n522 from t = 0.1 ps |

In 600 s the edge window gets only 114 ps past the first driver transition. The largest receiver swing in the
reference up to 164 ps is 1e-7 mV, so the edge has not reached any receiver. These deltas therefore cannot test
switching accuracy for either formulation. The full 1 ns edge window is not feasible within the 10-minute bound,
because it needs at least 85 points at about 14 s each. Accuracy evidence for the switching interval is the
matrix-level effective-L error above and the small-board parity.

**The start of the transient is fragile, even for the baseline.** Changing only tstop on the unchanged
coupled-inductor deck, from 0.5 ns to 0.3 ns, changes ngspice's first step. That baseline then reached only
3.0e-14 s in 600 s, with sane node voltages and a collapsing timestep, while the 0.5 ns run completed. The
susceptance 1e-2 stall (sane voltages, timestep collapsing near 1.6 ps) has the same signature, so it is not
attributed to the formulation.

The L-space 1e-2 deck fails differently. It diverges to 1e22–1e31 V at probe node n522 on its first transient step,
in both windows and with no stimulus change, although its L is provably positive definite. With a 1 ps window
(tstop = 1e-12), both decks run cleanly under KLU, and `k0.01` matches `k` within 4.5e-8 mV:

| Variant | Points | Transient iterations | Transient factor s | Factor s per iteration | Transient LU fill-in |
|---|---|---|---|---|---|
| `k` | 16 | 30 | 21.38 | 0.71 | 8,753,677 |
| `k0.01` | 16 | 30 | 14.54 | 0.48 | 6,895,325 |

The truncated L alone therefore does not cause the divergence: it depends on the run's first step, as the baseline
stall does. The transient reorders the matrix: its fill-in is 8.75M, against 23.8M at the operating point. A
discriminating run of `k0.01` in the 0.5 ns window under Sparse 1.3 (`klu` removed) did not finish the operating
point within 600 s. Whether KLU pivoting causes the divergence therefore remains untested.

**Operating-point matrix accounting.** The `op` window replaces `.tran` by `.op` under `.options acct`. Every variant
has 176,270 circuit equations and needs 7 Newton iterations.

| Variant | Original nonzeros | LU fill-in | Total nonzeros | op s (CPU) |
|---|---|---|---|---|
| `k` | 731,842 | 23,803,326 | 24,535,168 | 47.7 |
| Susceptance 1e-3 | 736,605 | 17,360,241 | 18,096,846 | 23.0 |
| Susceptance 1e-2 | 685,234 | 14,335,365 | 15,020,599 | 15.0 |
| `k0.01` | 672,772 | 9,998,701 | 10,671,473 | 8.5 |

KLU fill-in is 32 times the original matrix, and the factorization dominates each Newton iteration (about 6.8 s for
`k`). The weak couplings are what bridge the graph and create that fill. Dropping |k| ≤ 1e-2 in L space removes 58%
of it and makes the op 5.6 times faster. Susceptance at the same threshold removes only 40%, because each K pair
stamps four entries across two cells' nodes and flux nodes, and its inverse has more pairs than L at moderate
thresholds. At 1e-3, susceptance cuts op-time fill by 27%, yet the measured transient cost per point is unchanged
(edge table).

Bound note: two early runs overran the 600 s bound. Susceptance 1e-2 (quiet) ran 1,620 s before I stopped it, and a
first edge baseline under heavy load ran about 54 min (17 points to 70 ps; superseded by the table above). The
`perl alarm` wrapper did not terminate ngspice in those runs. The runner now also kills the exec'd ngspice pid from
the host 5 s after the bound, and an external watchdog enforced 600 s for every later run.

## Reproduction

```sh
IBIS_MODEL_DIR=<models> SI_DDR3_BOARD=<ddr3-board.json> SI_RESEARCH_DIR=<ignored dir> \
SI_NGSPICE=<machine ngspice lock> SI_NATIVE_SECONDS=600 \
bun scripts/research-inverse-inductance.tsx two            # or: differential
SI_THRESHOLDS=k,0.001,0.01,k0.01 SI_WINDOW_SECONDS=5e-10 bun scripts/research-inverse-inductance.tsx ddr quiet
SI_THRESHOLDS=k,0.001,k0.01 bun scripts/research-inverse-inductance.tsx ddr edge
SI_THRESHOLDS=k,0.001,0.01,k0.01 bun scripts/research-inverse-inductance.tsx ddr op
SI_THRESHOLDS=k,k0.01 SI_WINDOW_SECONDS=1e-12 bun scripts/research-inverse-inductance.tsx ddr quiet
```

| Variant code | Meaning |
|---|---|
| `k` | Coupled-inductor baseline (the default deck) |
| `k<t>` | L-space control: route K lines with \|k\| ≤ t dropped |
| `<t>` | Susceptance truncated at t |

`edge` shifts every PWL source earlier by `SI_SHIFT_SECONDS` (default 2.45 ns). All sources hold their DC value until
at least 2.5 ns, so the shift is an exact time translation from the operating point. `op` replaces `.tran` with `.op`.
`SI_SPARSE=1` removes `klu` from `.options`. Every deck gets `.options acct`, which changes accounting output only.
The runner holds the shared lock for each run and kills the exec'd ngspice from the host after
`SI_NATIVE_SECONDS` + 5 s. Decks, raw files, vendor IBIS and the board JSON stay in the ignored output directory.
