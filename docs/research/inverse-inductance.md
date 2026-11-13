# Inverse-inductance (susceptance) realization of the routed ladder

Research spike on `fix/routed-ddr3-level4` (#75, head `329a32c`). Question: does replacing the coupled
inductors and K lines of the routed DDR3 ladder by a sparsified inverse-inductance matrix K = L⁻¹
make the level-4 transient fast enough, while staying accurate and passive?

**Verdict: no.** The premise behind sparsified susceptance (Devgan/Ji/Dai, ICCAD 2000; VPEC; window
sparsification) is that partial inductance L is dense and slow-decaying, while L⁻¹ is local. The routed
ladder L is not a PEEC partial-inductance matrix. It is a 2D quasi-TEM assembly: cells couple only
laterally, inside a shared cross-section slice, with no longitudinal partial mutuals. It is already sparse
(about 2 mutual pairs per cell) and strictly diagonally dominant. Its inverse fills in along overlapping
cell chains. At equal truncation thresholds, K keeps as many pairs or more, with a larger effective-L
error. Each kept K pair also costs twice the matrix entries of a K line in ngspice. Measured runs (below)
confirm that the susceptance decks are not faster.

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

Two-trace (`examples/routed/two-trace-board.tsx`, 44 cells, 40 ns):

| Variant | K lines | G sources | Flux nodes | Points | Analysis s | Max Δ mV |
|---|---|---|---|---|---|---|
| Coupled inductors (reference) | 220 | 1,188 | 0 | 2,089 | 1.248 | 0 |
| Susceptance t = 0 (exact) | 0 | 2,508 | 440 | 2,089 | 1.870 | 0.00002 |
| Susceptance t = 1e-3 | 0 | 2,508 | 440 | 2,089 | 1.879 | 0.00002 |
| Susceptance t = 1e-2 | 0 | 1,320 | 44 | 2,089 | 1.602 | 0.040 |
| Susceptance t = 3e-2 | 0 | 1,320 | 44 | 2,089 | 1.680 | 0.040 |
| Susceptance t = 1e-1 | 0 | 1,320 | 44 | 2,089 | 1.568 | 0.040 |

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
deck is 28–50% slower. The differential timings differ by less than run-to-run noise on this shared machine.

## DDR3 bounded windows

Pending: see the PR updates.

## Reproduction

```sh
IBIS_MODEL_DIR=<models> SI_DDR3_BOARD=<ddr3-board.json> SI_RESEARCH_DIR=<ignored dir> \
SI_NGSPICE=<machine ngspice lock> SI_NATIVE_SECONDS=600 \
bun scripts/research-inverse-inductance.tsx two            # or: differential
SI_THRESHOLDS=k,0.001,0.01,k0.01 SI_WINDOW_SECONDS=5e-10 bun scripts/research-inverse-inductance.tsx ddr quiet
SI_THRESHOLDS=k,0.01,k0.01 bun scripts/research-inverse-inductance.tsx ddr edge
```

`k` is the coupled-inductor baseline. `k<t>` drops route K lines with |k| ≤ t, which is the L-space control. `<t>` is
the susceptance threshold. `edge` shifts every PWL source earlier by `SI_SHIFT_SECONDS`. All sources hold their DC
value until at least 2.5 ns, so the shift is an exact time translation from the operating point. Decks, raw files,
vendor IBIS and the board JSON stay in the ignored output directory.
