# Xyce vs ngspice for the routed DDR3 level-4 deck

Status (2026-11-13): **not measured.** The benchmark host was unreachable for the
whole session: Cloudflare returned error 1033, meaning the host's tunnel was down. No
simulator was run. This file records the translation, the source-level findings and
the exact runbook, so that the measurement can be run once the host is back.

## Question

The routed DDR3 address/command deck (PR #75, `fix/routed-ddr3-level4` at
329a32c) has about 1,765 ladder cells, 36,814 `K` lines and about 17 MB of
text. ngspice 47 takes about 5.6 s per saved point on it. Is Xyce (Sandia) much
faster on the same hardware?

## Translation (`scripts/xyce-deck.ts`)

| ngspice construct in the routed deck | Xyce form | Exact? |
|---|---|---|
| Title line | unchanged (Xyce also treats line 1 as the title) | yes |
| `.options klu reltol=1e-4 abstol=… vntol=1e-6 method=gear maxord=2` | `.options timeint method=gear maxord=2 reltol=1e-4 abstol=1e-6` and `.options linsol type=klu` | tolerance semantics differ: Xyce has one LTE `abstol` for every unknown, so `vntol` is used; ngspice's current `abstol` has no direct equivalent |
| `.save v(…) i(v.xibis0.…)` | `.print tran format=csv file=waveform.csv v(…)`. Xyce `.SAVE` means "save operating point", so it must not be passed through | the branch-current saves exist only for ngspice B-source dependencies and are dropped |
| `.tran step stop 0 step` | identical (`<tstep> <tstop> <tstart> <dtmax>`) | yes |
| `B… I={V(KU,REF)*pwl(min(max(x,x0),xN),x0,y0,…)}` from ibis-to-spice | `pwl(` → `table(`. Xyce's expression grammar has no `pwl()` (`ExpressionLexer.l`), but `table()` interpolates linearly and holds the end values | yes, because the argument is already clamped to the table domain |
| `E… a 0 value={…}` (modal dielectric shunt) | unchanged: Xyce accepts `VALUE=` on E/G (`N_IO_DeviceBlock.C`) | yes |
| `V… PWL(t v …)` IBIS switching coefficients | unchanged | yes |
| linear `R L C G E F H V`, `.subckt`/`.ends`, `X` | unchanged; subcircuit paths print as `x1:node` instead of ngspice `v.x1.vname` | yes |
| `K… La Lb k` (36,814 lines) | **default: removed, and each coupled inductor becomes `L_i` followed by one VCVS per mutual term:** `V_i = L_i dI_i/dt + Σ_j (M_ij/L_j)·V(L_j self part)`. `--native-mutual` keeps the K lines | exact algebraic identity; it adds two unknowns per mutual term |
| ngspice `-r waveform.raw` (ASCII raw) | Xyce CSV print file; `scripts/xyce-compare.ts` compares the two on ngspice's own time points | — |

### Why the K lines are rewritten

Xyce does not keep a K line as a sparse coupling stamp. In pass 1,
`CircuitBlock::parseMutualInductances` (`src/IOInterfacePKG/N_IO_CircuitBlock.C`)
merges every set of K lines that share an inductor, directly or through a chain,
into one `YMIL` device. `MutIndLin` (`src/DeviceModelPKG/OpenModels/N_DEV_MutIndLin.C`,
`jacStamp[2n+i].resize(n+2)`) then stamps a **dense n×n branch-current block**.
That includes structural zeros.

In the routed ladder, every cell couples to the overlapping cells of its
neighbouring traces, so each of the 10 inductor families (`ARCL` plus the 9
causal-loss pole families `ARCP0..8`) is expected to form one component of up to
about 1,765 inductors:

- **Dense native form:** about 3.1 M Jacobian entries per family and about 31 M in
  total, against about 74 k mutual entries in ngspice. KLU on a dense 1,765 block
  costs about 3.7 GFLOP per family per factorization.
- **Grouping cost:** the loop restarts the scan after each merge, so grouping is
  O(K²) with K = 36,814 before simulation starts.

The VCVS chain keeps the same sparsity as ngspice. `--native-mutual` exists so
that this prediction can be measured, not assumed.

## Runbook (user space, no sudo)

1. `scripts`: `xyce-build-tools.sh` installs micromamba with a conda-forge toolchain,
   builds ngspice 47 (the same release as the Mac baseline), and builds
   Trilinos 16.1 from source with Xyce's own `cmake/trilinos/trilinos-base.cmake`
   and `trilinos-MPI-base.cmake` presets, then Xyce 7.10 serial and MPI.
   conda-forge's Trilinos 16.2 cannot be used: it is built with
   `ALL_OPTIONAL_PACKAGES=OFF` and without the EpetraExt BTF, EXPERIMENTAL and
   GRAPH_REORDERINGS features that Xyce's configure requires (`cmake/tps.cmake`).
2. Decks: `IBIS_MODEL_DIR=<private> SI_DDR3_BOARD=<private>/ddr3-board.json SI_STAGE_VISUALS_DIR=<private>/out bun scripts/render-routed-stages.tsx`
   writes `two-trace.cir` and `ddr3-addr-cmd.cir` and stops before stage 5. No
   solver runs.
3. Parity: run ngspice and Xyce on `two-trace.cir`, in both K modes, then run
   `bun scripts/xyce-compare.ts waveform.raw waveform.csv`. The target is a maximum
   difference of 1 mV or less on every probe.
4. Timing: run `xyce-bench.sh` for one simulator at a time, each with a 1,800 s timeout.
   Windows: 1 ns quiet, then up to 1 ns after the first IBIS edge, then 8 ns.
   Engines: ngspice, serial Xyce with the VCVS chain, serial Xyce with
   `--native-mutual`, and MPI Xyce (`-np 4/8`, KLU and AztecOO).

## Measurements

None. The host was unreachable, so the tables below are empty on purpose.

| Window | ngspice 47 | Xyce serial (chain) | Xyce serial (native K) | Xyce MPI |
|---|---|---|---|---|
| 1 ns quiet | not run | not run | not run | not run |
| first edge + 1 ns | not run | not run | not run | not run |
| 8 ns | not run | not run | not run | not run |

## Expectation (to be checked, not a result)

With `.options klu`, ngspice and Xyce factor with the same KLU algorithm. A serial
speed-up would therefore have to come from fewer time steps or fewer Newton
iterations, not from a faster factorization. Xyce MPI parallelizes device loads,
but KLU itself is serial, and AztecOO GMRES/ILU often fails on circuits made of
ideal sources and gyrators. A large serial speed-up is not expected. Native K
lines are expected to be much slower than ngspice.
