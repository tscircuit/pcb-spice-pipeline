# 2D extraction implementation report

Local implementation candidate on two stacked branches. The new path uses physical TSX copper,
layered 2D BEM, closed-form vias and automatic primitive RLGC/Foster networks. It never invokes
FastHenry or FasterCap. This is **not a speed or whole-board accuracy qualification**: the speed
requirements remain unmet, and the real-TI switching-package variant fails native convergence.
No branches have been pushed and no PRs opened.

## Branches and implementation

- `si-2d/repro`: reproduction branch; final head and line counts are reported with delivery.
  The original BEFORE snapshot is `8a85951c6cd6b1ebd76c8dca3ea8e89d585446a9`.
  Actual TSX crosstalk/multilayer boards, lane-order and invented-return reproductions, opt-in native
  3D harness. The original RS-485 TSX now reproduces 11.716323/4.169378 nH on native solvers.
  The fresh three-link SC70 baseline raises the expected R `mesh_convergence`: residual
  0.128292996947 > 0.05 after 3667.640 s; 0.271606591 is the separate historical measurement.
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
**estimated** nonzero entries to change by less than 0.5%. Richardson orders are 2 then 4 for capacitance/dielectric sensitivity,
and 4/3 then 2 for the quartic-graded rectangular-corner surface-current integral.
Raw residuals are logged separately: they are not required to be below 0.5%. For example the coupled
stripline stops at 6,912 panels with estimated maximum 0.1672% and raw maximum 2.0378%.
The entry-wise check compares the published reciprocal matrices; unprojected estimates must also pass
reciprocity. There is no matrix-norm floor: arbitrarily small nonzero mutual entries receive the
same relative test. Two exact zeros count as unchanged, and a nonzero-to-zero change counts as 100%.
A mesh that exhausts floating-point resolution fails with `mesh_convergence`, without a fallback.

The first quiet-middle attempt exposed nearly coincident optional mesh alignment cuts. Merging
those cuts at the documented topology precision preserves conductor boundaries. Its actual TSX
slice 179 now converges in a focused regression (7.49 s). All strict quiet slices have converged;
quiet native simulation and repeat checks pass; all-active native runs are in progress.

## Native timing measurements

Apple M5, 16 GiB RAM, Node 26.13.0, ngspice 47. Runs were CPU/memory-contended with independent
work on the machine. Values are measured wall seconds, not estimates. Extraction timing excludes
TSX rendering and most admission; native timing includes request/output I/O. Warm-cache results
are identified separately and are not cold-extraction speed claims.

| Board | BEFORE extraction, straightened 3D | AFTER extraction, 2D | BEFORE ngspice | AFTER ngspice | AFTER mesh policy |
|---|---:|---:|---:|---:|---|
| single-ended | 89.113 | 52.356 | 6.195 | 13.517 | final strict entry-wise estimates |
| differential-data | 11.603 | 1609.389 | 10.233 | 243.898 | final strict entry-wise estimates |
| crosstalk, shared geometry | 234.089 | 4144.831 | 27.210 | pending | final strict entry-wise estimates, first quiet solve |
| multilayer | 491.585 | 653.178 | 4.660 | 44.742 | final strict entry-wise estimates |

Three default boards now completed two actual native runs under the final strict policy, with every
artifact and request identical. Their cached second extraction/native times are: single-ended
0.0278/12.861 s; differential 0.1626/198.242 s; multilayer 0.0592/48.104 s. The crosstalk row
uses its first cold quiet-middle geometry solve. Its strict native quiet/all-active runs are in
progress; the earlier C/C0-only increment took 420.993 s extraction / 842.539 s native. All default examples explicitly omit package parasitics, preserving the original
experiment choice. The separate package variant is discussed below.

The seconds-level extraction target is not met across the examples. The final differential and
earlier crosstalk native processes also exceed one minute. The dense BEM reaches 11,776 panels on crosstalk. The top decks contain 865 / 12,609 / 17,653 /
4,352 primitives for single-ended / differential / crosstalk / multilayer respectively, before IBIS
subcircuit expansion; control commands are excluded from these counts. These large stiff primitive
ladders are the closest implemented alternative; there is no timeout, reduced fidelity fallback or hidden
limit to manufacture a pass. Faster adaptive field solution/model reduction remains further work.

BEFORE used the reproduction checkout's actual FastHenry/FasterCap extractor. Existing examples
used their original settings. New crosstalk used legacy extraction settings with derived 2 mm returns;
new multilayer additionally needed an explicit legacy via profile, .025 mm plating, equivalent
width pi*(.3+.025) mm and omitted through-via stubs. These old controls are absent from the new path.
The initial extraction-only baseline measured 37.898 s / 10.058 s for single/differential; the full
BEFORE-eye measurements above supersede them and show contention variability.


A fresh native opt-in reproduction of the original 44 x 12 mm RS-485 board gives 11.716323 nH
straightened versus 4.169378 nH routed, with C12=-0.909219/-0.187355 pF. Extraction takes
1.427/2592.909 s under contention; the regression passes. This is the original comparison geometry,
not the repository default example. The default BEFORE RS-485 example's explicit 0.35 mm return
profile instead produces 30.447940 nH. Its timing/eye rows must not be conflated with the 11.7 nH case.

## Native crosstalk

The held-low middle lane completes twice natively: 444.066 / 408.583 s, with cold / cached extraction
4144.831 / 0.1197 s. Its 218 segments use 193 distinct solved slices and 219 automatic cells. Every
canonical artifact and native request is byte-identical on the repeat. Reversing lane order produces
identical matrices and native requests; that additional permutation check replays the measured
output only after exact request equality, rather than claiming a third native execution.

| Case | Middle NEXT max abs(V) | Middle FEXT max abs(V) | Native repeats | Lane permutation |
|---|---:|---:|---|---|
| middle held low | 0.186694 | 1.125206 | identical, two actual runs | identical input/matrices |
| all active | pending | pending | in progress | pending |

Peaks use every native recorded sample after the declared eye gate starts. In the all-active case
they include the driven signal; the held-low row isolates noise on the victim. These are finite
packet measurements, not BER or receiver compliance claims.

## Closed-form accuracy, unit-tested field solver

Finite 40 mm ground width, 1 mm signal width, 1 micrometre signal thickness, er=4. Microstrip h=1 mm;
stripline plane spacing 2 mm; coupled gap .5 mm. These are four test configurations, not a sweep of
all geometries. Single microstrip uses Hammerstad–Jensen; stripline uses Wheeler; coupled microstrip
uses the published Hammerstad–Jensen modes; coupled stripline uses Cohn's elliptic-integral result.
All listed errors are below 2%; the largest is 0.5537%. This does not validate RF conductor-loss
accuracy, vias, bends or split-return discontinuities against a 3D field solver.

| Configuration | Quantity | Published oracle | 2D result | Error |
|---|---|---:|---:|---:|
| single microstrip | Z0 (ohm) | 74.103195 | 73.943537 | -0.2155% |
| single microstrip | effective er | 2.914643 | 2.918273 | +0.1246% |
| single stripline | Z0 (ohm) | 50.064094 | 50.117087 | +0.1059% |
| single stripline | effective er | 4.000000 | 4.000000 | -0.0000% |
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

The four-branch fits have measured weighted relative RMS residuals: CMOS skin 14.834%, dielectric 6.647%;
RS-485 skin 6.018%, dielectric 1.470%. These are fit errors for the added loss terms, not total line
impedance errors. The objective normalizes tiny/zero samples at the named fraction of the band peak;
this loss-fit weighting does not relax any mesh-entry convergence test. Skin transition uses the documented DC/f^2/high-frequency sqrt(f) approximation;
frequency-resolved eddy-current accuracy is not established. Via RLC is frequency-independent.

The default examples explicitly declare bare copper without solder mask. A separate actual TSX
variant verifies mask retention, the bottom-copper coordinate origin and via-span permittivity.
A layered FR4/mask parallel-plate energy check gives C=7.136980 nF/m versus 7.088589 nF/m
(+0.6827%), and dielectric-loss coefficient D=0.146714 nF/m versus 0.146071 nF/m (+0.4404%).
Positive finite-plate fringing is included in the numerical result; the reference is infinite width.
These layered/mask checks are unit-only, not native masked-board qualification.
Native complex multiport tests validate the implemented causal networks against independent
complex algebra; they do not establish the accuracy of the physical skin/dielectric approximation.

## RS-485 mutual inductance

Signed sum along the selected A/B driver-to-receiver paths at the IBIS knee, **777240.733 Hz**:
**1.565388 nH**, including the causal Foster networks' internal inductive storage. The external
quasi-TEM contribution alone is **1.504064 nH**. Against the supplied 4.2 nH reference the total
is **-62.73%**. Folded path directions are included. Both selected path graphs are unbranched
chains (52 A pieces, 58 B pieces); termination stubs remain in the simulated circuit.

The two physical layouts differ. The original 44 x 12 mm reference has a continuous 42 x 10 mm
bottom pour, standard SOIC pads, signal detours ending at x=19 mm and two local ground vias. The
updated default has custom SOIC pads, detours ending at x=20 mm, a 43 x 10 mm notched bottom pour
and longer routed supply/ground connections. Adding a pour changes the comparison against the
default BEFORE example; the original 4.2 nH reference already had one. It cannot alone explain that
reference gap. Local 2D extraction omits ground-lead/spreading inductance, bend fringing and magnetic
coupling between oblique pieces; ideal DC rail copper is AC equipotential. These change the return
flux and common inductance. Their individual contributions have not been isolated. The 62.73% gap
is a remaining, unqualified board-level discrepancy, not a same-geometry accuracy pass.

## Native eye measurements

Independent finite-packet estimator in `scripts/measure-eyes.mjs`: exact piecewise-linear high/low
envelopes over every recorded phase interval. Height is maximum envelope separation. Width is the
longest phase interval meeting all declared low/high thresholds, CMOS .8/2 V and conservative
RS-485 -.2/+.2 V. These are observed-packet metrics, not BER estimates or protocol compliance.

| Board | BEFORE height V | AFTER height V | BEFORE width UI | AFTER width UI | BEFORE/AFTER width |
|---|---:|---:|---:|---:|---|
| single-ended | 3.299992 | 3.299976 | .832434 | .933093 | 41.6217 / 46.6547 ns |
| differential-data | 4.470763 | 4.471156 | .785567 | .785584 | 3.142269 / 3.142336 us |

These AFTER values use the completed final-policy native runs. Height barely changes; single-ended
width increases 5.033 ns and RS-485 width changes only 66.8 ps. Return geometry, routed segmentation and causal losses all changed together, so this is
not an isolated attribution of the improvement. Single-ended also adds real bottom ground copper
at x=-18..18, y=-5..0.3 mm. The multilayer board is now four layers with actual circular antipad voids
and split inner/bottom ground pours; its earlier two-layer reproduction was not a qualified board.
Blind-via fabrication is explicitly enabled; its physical geometry equals the earlier saved copper.

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

- Reproduction branch: `pnpm build` passes; `pnpm test` gives **297 passed / 1 skip, zero failed**,
  53.195 s; `pnpm test:native` gives **2 passed / 1 vendor-gated skip, zero failed**, 14.278 s.
  Both separate opt-in native 3D checks pass their specific gap/non-convergence assertions.
- `pnpm build`: passed. `pnpm test`: **244 passed, zero failed**, 286.726 s, including actual-TSX
  hole rejection, masked via geometry, layered dielectric energy and 250000-element numeric reductions. The previous first-extrapolation checkpoint
  passed 242/242 in 881.928 s; one obsolete timeout test was replaced by the hole regression.
- `pnpm test:native`: **6 passed / 1 vendor-gated skip, zero failed**, 4.121 s. Includes dynamic
  synthetic supply-pin packages, twelve lanes and bit-identical internal-branch save restriction.
  Separate real-TI runs are above.
- `pnpm test:package`: passed packed Node execution, denied-host execution, NodeNext declarations
  and Bun execution. The packaging runner streams without timeout or output-buffer limits.
- Lint, module graph, vocabulary and type checking pass; the 100001-bit actual TSX admission test
  passes through patched props, core and Circuit JSON. Native primitive test executes twelve lanes.
- Native: final-policy single-ended, differential and multilayer, twice with identical artifacts;
  earlier crosstalk; fresh original RS-485 3D gap;
  fresh three-link SC70 R non-convergence; static and frequency-dependent complete multiport
  primitive networks; independent baseline/eyes.
- Unit-only: published uniform-line accuracy, closed-form via accuracy, missing-data diagnostics,
  geometry lane-order invariance. Quiet NEXT/FEXT and lane permutation now pass natively as described above. All-active native
  second-run checks are still pending; speed and 4.2 nH accuracy targets remain unmet.

Evidence is in ignored `runs/2d`, `runs/qualified`, `runs/before-eyes`, native request directories
and persistent `runs/checks` logs. Fresh BEFORE evidence is in the separate reproduction worktree
`../si-api-review/si-2d-before/runs/2d-baseline`. Reproduce using `node --import tsx scripts/measure-2d.mjs ...`; it runs twice
natively and checks every artifact, then proves crosstalk lane permutation by exact native-request
comparison and replay of the measured output. `scripts/measure-legacy.mjs ABS_REPRO_CHECKOUT ...`
measures BEFORE only. Use a fresh `SI_MEASUREMENT_DIRECTORY` for a new solver version; a stale
checkpoint deliberately errors rather than being reused. `measure-accuracy.mjs`, `measure-eyes.mjs` and `measure-mutual.mjs` write or
print the independent numeric tables. Model bytes are fetched by pinned URL/archive/file hashes;
`examples/differential-data/verify-vendors.mjs` passed fresh verification in this task.

An additional diagnostic made the first fitted driver coefficients continuous at transitions. It
moved the package abort to 101.597 ns but did not resolve it; that change was not adopted.

Building the small IEEE-double WebAssembly LU required installing Homebrew lld; Homebrew also
upgraded LLVM from 23.1.4 to 23.1.5. No native extraction tool was installed or used in the new path.

The Mac reboot at 00:19 on 2026-11-09 interrupted the first strict quiet simulation and two BEFORE
checks, and cleared `/tmp`. Recovery evidence stays in the workspace. The measurement script now
checkpoints converged slices before native execution, guarded by solver-source fingerprints and
convergence/matrix validation. A separate process restored the single-ended checkpoint, executed
ngspice twice, and reproduced all 58 canonical files. A deliberately stale fingerprint raises
`measurement_cache_version`. Cached timings are identified; stored waveforms never replace native runs.

Bounded saved-request diagnostics did not establish a faster native backend: KLU aborts at 8 us
of the requested 128 us differential run, and at 100 ns for the package variant, despite native
exit code 0. An algebraically equivalent scalar RL/RC realization completes multilayer in 56.232 s
under contention and still aborts the package variant at 100 ns. No dependable speedup was
established, and neither diagnostic changed the implementation. The latest complete pipeline attempt
with the standard real-TI package also raises `native_solver` at 100 ns, timestep 6.25e-23 s,
node `xibis0.pkgl0`; its request and logs are in `runs/package-final-requests`.

The completed reproduction history is merged into the fix with an explicitly tree-preserving merge.
Its legacy-only 3D helpers and old numerical controls are intentionally superseded by the tested
2D implementation; the fresh measurements above remain inspectable on the reproduction branch.
The final numerical-policy edit documents existing fit weights and plotting density only; no
numerical values or runtime operations changed after the full verification run.

Final-policy measurements execute the implementation at `30fdfe3140d733719c565b4a4998f7fd67098ff1`.
The later source edit adds policy comments only; final build, lint, module, vocabulary, types and
five documentation checks pass. The complete test and packaging runs precede that comment-only edit.
