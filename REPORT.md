# 2D extraction implementation report

Local implementation candidate on two stacked branches. The new path uses physical TSX copper,
layered 2D BEM, closed-form vias and automatic primitive RLGC/Foster networks. It never invokes
FastHenry or FasterCap. This is **not a speed or whole-board accuracy qualification**: the speed
requirements remain unmet, and the real-TI switching-package variant fails native convergence.
No branches have been pushed and no PRs opened.

## Branches and implementation

- `si-2d/repro`: `8a85951c6cd6b1ebd76c8dca3ea8e89d585446a9`, +223/-1 lines, 12 files.
  Actual TSX crosstalk/multilayer boards, lane-order and invented-return reproductions, opt-in native
  3D harness. The historical 11.7/4.2 nH and SC70 R residual 0.271606591 come from the supplied
  prior evidence; they are not newly measured routed-copper results.
- `si-2d/fix`, stacked on it: initial native single-ended increment `8d03416`, broader working
  increment `871e922`, followed by all-matrix convergence/physical-edge/limiter corrections.
  Final head and complete line counts are reported with delivery.

The old 3D mesh/deck builders, invented return generator, routed/straightened split and extraction
settings are removed. The plain stages are described in [docs/2d-extraction.md](docs/2d-extraction.md).
All numerical policy is named in `src/kernel/numerics.ts`. There are no pipeline process timeouts,
mesh/fit retry counts, lane/cell clamps, pattern-length budgets or eye/DDR analysis budgets.
Missing physical data raises named diagnostics. An input-only experiment needs a physical pulse
edge; solver timestep is not a physical edge. Upstream props/Circuit JSON/core/converter fixes are
carried as four pnpm patches, pending equivalent releases. No `bun patch` was used.

Every slice includes the physical metal and layered materials. Floating neutral conductors are
Schur-reduced; L = mu0 epsilon0 inverse(C0). Vacuum surface currents supply skin/proximity loss;
directional material sensitivity supplies dielectric loss. Four nonnegative Foster branches are
fitted across the IBIS-derived band. The tables include the reactive L(f)/C(f) of those same causal
networks. Cell count bounds LC delay, including storage, to rise_time/10 without a cell ceiling.
Shared junction nodes preserve routed folds and termination stubs; no CPL lane-limited device is used.

## What the convergence check certifies

Each refinement logs C/C0/L/surface-loss/dielectric-loss entry residuals. Termination requires all
**estimated** nonzero entries to change by less than 0.5%. Richardson orders are 2 for capacitance
then 4 for capacitance and dielectric sensitivity, and 4/3 then 2 for the quartic-graded rectangular-corner surface-current integral.
Raw residuals are logged separately: they are not required to be below 0.5%. For example the coupled
stripline stops at 6,912 panels with estimated maximum 0.1672% and raw maximum 2.0378%.
The entry-wise check compares the published reciprocal matrices; unprojected estimates must also pass
reciprocity. There is no matrix-norm floor: arbitrarily small nonzero mutual entries receive the
same relative test. Two exact zeros count as unchanged, and a nonzero-to-zero change counts as 100%.
A mesh that exhausts floating-point resolution fails with `mesh_convergence`, without a fallback.

The first quiet-middle attempt exposed nearly coincident optional mesh alignment cuts. Merging
those cuts at the documented topology precision preserves conductor boundaries. Its actual TSX
slice 179 now converges in a focused regression (7.49 s). The complete quiet native rerun is pending.

## Native timing measurements

Apple M5, 16 GiB RAM, Node 26.13.0, ngspice 47. Runs were CPU/memory-contended with independent
work on the machine. Values are measured wall seconds, not estimates. Extraction timing excludes
TSX rendering and most admission; native timing includes request/output I/O. Warm-cache results
are identified separately and are not cold-extraction speed claims.

| Board | BEFORE extraction, 3D | AFTER extraction, 2D | BEFORE ngspice | AFTER ngspice | AFTER mesh policy |
|---|---:|---:|---:|---:|---|
| single-ended | 89.113 | 49.787 | 6.195 | 11.290 | final reciprocal two-level estimates |
| differential-data | 11.603 | 603.187 | 10.233 | 684.055 | earlier C/C0-only increment |
| crosstalk, all active | 234.089 | 420.993 | 27.210 | 842.539 | earlier C/C0-only increment |
| multilayer | 491.585 | 1276.748 | 4.660 | 51.013 | all-matrix estimates |

All four AFTER rows completed actual native ngspice, with real TI bytes. The differential/crosstalk
rows do not qualify the final all-matrix stopping policy; stricter full reruns are in progress.
The earlier C/C0-only multilayer run was extraction 143.720 s / ngspice 85.300 s; the stricter skin
criterion makes the cost visible. Final single-ended second native run: extraction 0.0288 s (cached),
ngspice 9.895 s, total 10.363 s. Every artifact and the native request were bit-identical.

The seconds-level extraction target is not met across the examples. The earlier differential and
crosstalk native processes also exceed one minute. The dense BEM and large stiff primitive ladders
are the closest implemented alternative; there is no timeout, reduced fidelity fallback or hidden
limit to manufacture a pass. Faster adaptive field solution/model reduction remains further work.

BEFORE used the reproduction checkout's actual FastHenry/FasterCap extractor. Existing examples
used their original settings. New crosstalk used legacy extraction settings with derived 2 mm returns;
new multilayer additionally needed an explicit legacy via profile, .025 mm plating, equivalent
width pi*(.3+.025) mm and omitted through-via stubs. These old controls are absent from the new path.
The initial extraction-only baseline measured 37.898 s / 10.058 s for single/differential; the full
BEFORE-eye measurements above supersede them and show contention variability.

## Closed-form accuracy, unit-tested field solver

Finite 40 mm ground width, 1 mm signal width, 1 micrometre signal thickness, er=4. Microstrip h=1 mm;
stripline plane spacing 2 mm; coupled gap .5 mm. These are four test configurations, not a sweep of
all geometries. Single microstrip uses Hammerstad–Jensen; stripline uses Wheeler; coupled microstrip
uses the published Hammerstad–Jensen modes; coupled stripline uses Cohn's elliptic-integral result.
All listed errors are below 2%; the largest is 0.5538%. This does not validate RF conductor-loss
accuracy, vias, bends or split-return discontinuities against a 3D field solver.

| Configuration | Quantity | Published oracle | 2D result | Error |
|---|---|---:|---:|---:|
| single microstrip | Z0 (ohm) | 74.103195 | 73.943537 | -0.2155% |
| single microstrip | effective er, even | 2.914643 | 2.918273 | +0.1246% |
| single stripline | Z0 (ohm) | 50.064094 | 50.117087 | +0.1059% |
| single stripline | effective er, even | 4.000000 | 4.000000 | -0.0000% |
| coupled microstrip | Ze (ohm) | 90.441144 | 90.298213 | -0.1580% |
| coupled microstrip | Zo (ohm) | 55.330197 | 55.222365 | -0.1949% |
| coupled microstrip | L12 (nH/m) | 116.660844 | 117.048381 | +0.3322% |
| coupled microstrip | C12 (pF/m) | -16.210649 | -16.161661 | -0.3022% |
| coupled microstrip | effective er, even | 3.104053 | 3.112821 | +0.2824% |
| coupled microstrip | effective er, odd | 2.610314 | 2.605317 | -0.1915% |
| coupled stripline | Ze (ohm) | 57.384087 | 57.294841 | -0.1555% |
| coupled stripline | Zo (ohm) | 41.761490 | 41.651488 | -0.2634% |
| coupled stripline | L12 (nH/m) | 52.111374 | 52.180609 | +0.1329% |
| coupled stripline | C12 (pF/m) | -21.745283 | -21.865686 | +0.5537% |
| coupled stripline | effective er, even | 4.000000 | 4.000000 | +0.0000% |
| coupled stripline | effective er, odd | 4.000000 | 4.000000 | +0.0000% |

Oracles and citations: [single microstrip](https://qucs.sourceforge.net/tech/node75.html),
[coupled microstrip](https://qucs.sourceforge.net/tech/node77.html),
[coupled stripline](https://qucs.sourceforge.net/tech/node76.html),
Wheeler, IEEE MTT-13 (1965), pp.172–185. Via formulas are TI Analog Engineer's Pocket Reference
[eqs.87–88](https://www.ti.com/lit/eb/slyw038c/slyw038c.pdf), unit-tested against the worked equations.

The four-branch fits have measured relative RMS residuals: CMOS skin 14.834%, dielectric 6.647%;
RS-485 skin 6.018%, dielectric 1.470%. These are fit errors for the added loss terms, not total line
impedance errors. Skin transition uses the documented DC/f^2/high-frequency sqrt(f) approximation;
frequency-resolved eddy-current accuracy is not established. Via RLC is frequency-independent.
Native complex multiport tests validate the implemented causal networks against independent
complex algebra; they do not establish the accuracy of the physical skin/dielectric approximation.

## RS-485 mutual inductance

Signed sum along the selected A/B driver-to-receiver paths: **1.504046 nH**, versus supplied prior
real-copper 3D reference **4.2 nH**, difference **-64.19%**. Folded path directions are included; the
naive first-entry sum 1.476879 nH is not the comparison quantity. Both selected path graphs are
unbranched chains (52 A pieces, 58 B pieces); termination stubs remain in the circuit.

This is not a same-geometry 3D accuracy pass. The updated RS-485 TSX adds a broad bottom ground
pour, whereas the prior routed reference used the earlier board copper. Local 2D extraction also
omits ground-lead/spreading inductance, bend fringing and magnetic coupling between oblique pieces.
Ideal DC rail copper is AC equipotential. All of these affect return flux and mutual L. Their
individual contributions have not been isolated; the large remaining gap is explicitly unqualified.

## Native eye measurements

Independent finite-packet estimator in `scripts/measure-eyes.mjs`: exact piecewise-linear high/low
envelopes over every recorded phase interval. Height is maximum envelope separation. Width is the
longest phase interval meeting all declared low/high thresholds, CMOS .8/2 V and conservative
RS-485 -.2/+.2 V. These are observed-packet metrics, not BER estimates or protocol compliance.

| Board | BEFORE height V | AFTER height V | BEFORE width UI | AFTER width UI | BEFORE/AFTER width |
|---|---:|---:|---:|---:|---|
| single-ended | 3.299992 | 3.299976 | .832434 | .933093 | 41.6217 / 46.6546 ns |
| differential-data | 4.470763 | 4.471156 | .785567 | .785584 | 3.142269 / 3.142336 us |

These AFTER values currently use the earlier C/C0-only native runs; final-policy remeasurement is
pending. Height barely changes; single-ended width increases 5.033 ns and RS-485 width changes only
66.6 ps. Return geometry, routed segmentation and causal losses all changed together, so this is
not an isolated attribution of the improvement. Single-ended also adds real bottom ground copper
at x=-18..18, y=-5..0.3 mm. The multilayer board is now four layers with actual circular antipad voids
and split inner/bottom ground pours; its earlier two-layer reproduction was not a qualified board.

## Package parasitics and model boundaries

Vendor package R/L/C is accepted for signal and supply pins, with exact source bytes/SHA retained.
Per-pin values override package defaults. Standard C_pkg remains at the external pin relative to
board ground; R/L connect to the die. Coupled package models remain explicitly unsupported.
The real SN74LVC1G04 vendor-package run raises `native_solver` at 100 ns (timestep 6.25e-23 s).
Relaxing reltol did not fix it. A diagnostic pi-capacitance redistribution completed 2,319,845 native
samples but produced transmitter excursions -52.14..57.96 V; it changes the standard model and was
not adopted. Vendor bytes and the standard package circuit are preserved; native failures propagate with their logs.

The synthetic package fixture's power-clamp slope was active under the IBIS VCC-minus-pad axis;
its polarity is corrected, and the new dynamic package check passes natively. Real-TI switching package operation
remains unqualified even if the synthetic native check passes. The earlier package native test was
static bias, and must not be presented as dynamic validation.

Further boundaries: quasi-TEM, no radiation/bend fringing; oblique metal is neutral electrostatic
loading, with distributed magnetic coupling only between parallel co-propagating pieces. Real
reference copper is used, with ideal board-ground/DC-rail connections. Longitudinal supply/ground
connection impedance and via RF loss are not extracted. Continuous tapers, curved pour boundaries,
nonrectangular SMT pads and standalone drilled/plated holes raise named diagnostics. Routed fanout
requires distinct two-endpoint PCB routes meeting at shared junctions. These limits are recorded on results.

## Checks and remaining qualification

- `pnpm build`: passed. `pnpm test`: **242 passed, zero failed**, 157.475 s, including actual-TSX
  hole rejection and 250000-element numeric reductions. The previous first-extrapolation checkpoint
  passed 242/242 in 881.928 s; one obsolete timeout test was replaced by the hole regression.
- `pnpm test:native`: **6 passed / 1 vendor-gated skip, zero failed**, 2.791 s. Includes dynamic
  synthetic supply-pin packages, twelve lanes and bit-identical internal-branch save restriction.
  Separate real-TI runs are above.
- `pnpm test:package`: passed packed Node execution, denied-host execution, NodeNext declarations
  and Bun execution. The packaging runner streams without timeout or output-buffer limits.
- Lint, module graph, vocabulary and type checking pass; the 100001-bit actual TSX admission test
  passes through patched props, core and Circuit JSON. Native primitive test executes twelve lanes.
- Native: all four default boards on the earlier increment; stricter single-ended/multilayer;
  static and frequency-dependent complete multiport primitive networks; independent baseline/eyes.
- Unit-only: published uniform-line accuracy, closed-form via accuracy, missing-data diagnostics,
  geometry lane-order invariance. Native quiet NEXT/FEXT, lane permutation and remaining native
  second-run checks are still pending; speed and 4.2 nH accuracy targets remain unmet.

Evidence is in ignored `runs/2d`, `runs/qualified`, `runs/before-eyes`, native request directories
and `/tmp/si-*.log`. Reproduce using `node --import tsx scripts/measure-2d.mjs ...`; it runs twice
natively and checks every artifact, then proves crosstalk lane permutation by exact native-request
comparison and replay of the measured output. `scripts/measure-legacy.mjs ABS_REPRO_CHECKOUT ...`
measures BEFORE only. `measure-accuracy.mjs`, `measure-eyes.mjs` and `measure-mutual.mjs` write or
print the independent numeric tables. Model bytes are fetched by pinned URL/archive/file hashes;
`examples/differential-data/verify-vendors.mjs` passed fresh verification in this task.

An additional diagnostic made the first fitted driver coefficients continuous at transitions. It
moved the package abort to 101.597 ns but did not resolve it; that change was not adopted.

Building the small IEEE-double WebAssembly LU required installing Homebrew lld; Homebrew also
upgraded LLVM from 23.1.4 to 23.1.5. No native extraction tool was installed or used in the new path.
