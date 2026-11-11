# Addr/cmd qualification and board-fix experiment

This is a qualification of the **simulation candidate**, not a measurement of
the physical PCB. The source board remains read-only. The original result and
all attempted comparisons retain the [terminal-control limitations](terminal-inductance.md)
and [routed-model omissions](routed-2d.md). In particular, ideal die supplies,
approximate oblique coupling, open unmodeled neighbour endpoints, finite pour
edges and the package model's unused-pin reduction remain assumptions.

## Fixed experiment

The baseline is `runs/addr-cmd/capture-c2-r1`, commit `3d547bb`: AM3352
Model_352, Winbond CMD, no VTT, JLC08121H-3313, 1.5 V, 400 Mbps command
slots, deterministic seed-varied PRBS7 and the same two parity quiet-victim
experiments. CK/CKn remain the original complementary diagnostic edge,
not continuous DDR3 clock traffic. The full experiment retains 24 selected
routes; command metrics exclude the two clock legs. No protocol/timing
compliance or functioning DDR interface is inferred from these stress patterns.

The seeds are `32 + (7 * index) % 32`: all command seeds start with bits
`0,1`, so all 22 commands first rise together at 2.5 ns. The quoted first
crests are a coherent simultaneous-switching stress, not a statistical
distribution over a long PRBS traffic run. The complete 8 ns capture includes
later mixed data. All native cases use the same typical vendor corner.

Native solves run serially with `OMP_NUM_THREADS=1`, the exclusive lock,
all-native-solver admission, 1,024-cell guard, 20-minute per-run runtime and
1 GiB sampled native RSS cap unchanged. Incomplete captures, ngspice errors
and budget stops do not enter metric tables. Field-cache reuse requires the
same panel resolution and exact geometry/material keys. Reusing a deck also
requires matching board/vendor hashes, stimuli, duration bound and scope.
What-if transforms are recorded separately and cannot be silently removed
or applied twice during reuse.

Overshoot and undershoot use the nominal 1.5 V rails. Quiet-victim disturbance
removes the pre-edge DC baseline; it includes both routed copper and package
coupling. Settling uses the earlier 5% band and 0.5 ns confirmation/censoring
rule. Pulse area integrates native piecewise-linear samples above 1.5 V or
below 0 V, inserting exact rail crossings. Both the largest contiguous lobe
and the complete capture's sum are retained; they are different quantities.

## Spatial and coupling-radius checks

The full 818-cell, four-cells-per-rise, 4.999 ns retry was stopped by the
existing runtime projection at 965.030 s (projected 1,201 s), after its last
saved 2 ns checkpoint. Its sampled RSS maximum was 596.234 MiB. It supplies
**no peak, overshoot or crosstalk comparison**.

A TSX subset selects A4, A5, A7, A9, A11 and CASn by their original names,
retaining the original seeds/parity indices and all admitted nearby copper.
Its two/four-cells-per-rise attempts used 218/403 cells. Both ngspice runs
aborted near 2.5 ns with “timestep too small”; code 0 and later control-script
progress echoes do not make them complete captures. The source copper is
unchanged, but nonselected modeled bidirectional pins follow the existing
inactive-pin policy, so this subset is also a different electrical boundary
condition from the full bus. It must not be substituted for a converged
full-bus result.

The geometry-only reduced control declares all 24 original channels and
stimuli in TSX, and reduces only physical copper admission.
All 24 modeled routes are still completely present in the six-net neighbourhood;
the helper rejects a scope that omits any declared quiet channel. It retains
176 traces and 805 vias at 1 mm, versus the full scope's 256/901. This is a
geometrically reduced full-bus stress experiment. Matching its
two/three-cells-per-rise and one/two-mm cases avoids the earlier inactive-driver
confound without changing the switching pattern.

A separate six-aggressor control holds the other 18 drivers low. Its complete
218-cell main capture reaches 1.659537 V maximum (A9); A4 reaches 1.628178 V,
versus 2.024868 V in the original full-bus capture. Its native solve took
202.142 s. This is evidence of switching-activity sensitivity **inside the
model**, not spatial convergence. Its fine-mesh batch was stopped before
starting; the spatial experiment retains the full-bus stimuli instead.

The complete geometry-only two-cells-per-rise main case retains the original
24 stimuli. Its maximum is 2.098165 V (A9), 5.288 mV above the original.
For A4/A5/A7/A9/A11/CASn, peak changes are respectively
+5.623/+6.509/+7.068/+5.288/+2.234/+1.142 mV. The smaller copper admission
therefore retains the large modeled overshoot. This scope check is separate
from cells-per-rise and radius sensitivity. Although the original deck was
compiled for 8 ns and this deck for 4.999 ns, all 48 controller Ku/Kd profiles
agree through the comparison window to 7.9e-13 absolute coefficient units,
for both main and even-victim patterns. `switching-prefix-check.json` retains
that check and both deck hashes.

The reduced full-bus odd-victim capture aborted at 2.5 ns (50.568 s native,
139.859 MiB peak sampled RSS). Later progress echoes are invalid after that
abort. The bounded spatial/radius comparison therefore covers the main pattern
and worst even-victim pattern; odd-victim convergence remains unverified.
The 403-cell four-cells-per-rise main retry was manually stopped at 323.770 s:
its observed 1 ps-to-2 ns CPU rate, scaled against the completed coarse
profile, projected 1,599 s. That heuristic exceeds the per-run 1,200 s budget.
The completed bounded refinement uses three cells per rise on the same scope
and stimuli, without changing timestep, tolerance or native guards.

| Control | Cells | Maximum cell delay | Native main / even-victim time | Main maximum |
|---|---:|---:|---:|---:|
| 2 cells per rise, 1 mm | 218 | 112.640 ps | 404.625 / 432.440 s | 2.098165 V |
| 3 cells per rise, 1 mm | 304 | 75.075 ps | 453.116 / 438.454 s | 2.096157 V |

| Net | Fine peak | Peak change, fine minus coarse | Overshoot change |
|---|---:|---:|---:|
| A4 | 2.029161 V | -1.331 mV | -0.089 percentage points |
| A5 | 2.093520 V | -1.321 mV | -0.088 percentage points |
| A7 | 1.992238 V | -2.435 mV | -0.162 percentage points |
| A9 | 2.096157 V | -2.008 mV | -0.134 percentage points |
| A11 | 1.982869 V | -2.217 mV | -0.148 percentage points |
| CASn | 2.025822 V | -0.484 mV | -0.032 percentage points |

In the matched even-victim pattern, A4 remains the largest disturbance:
431.026 to 431.049 mV (+0.023 mV). Across all 11 quiet nets, the largest
absolute peak-disturbance change is 4.562 mV (CSn0). These are completed native
sensitivity results, not extrapolated zero-cell-size errors or hardware
qualification. The large main overshoot and worst A4 crosstalk persist at
the tested refinement. Odd-victim spatial convergence remains unverified.
See the small [spatial receiver overlay](../runs/addr-cmd/qualification/summary/spatial-overlay.png).

The intermediate full-bus three-cells-per-rise run used 633 cells and reached
the 4 ns checkpoint, but hit the unchanged 1,200 s native limit before the
requested 4.999 ns end. Full-scope convergence remains **unverified**;
no incomplete capture enters the comparison tables. The native RSS maximum
was 320.828 MiB. This is an execution limit, not evidence that refining the
mesh changes the peaks by zero.

The saved **partial 0-4 ns prefix only** gives the following diagnostic. It
is separate from accepted case metrics and is not a crest-convergence result.
All six original crests occur later than the saved fine checkpoint. Shorter
capture declarations can also change the existing bounded inactive IBIS-tail
policy; this prefix is not a proof of byte-identical switching coefficients.

| Net | Prefix peak change, 633 minus 444 cells | Prefix overshoot change | Original full crest time |
|---|---:|---:|---:|
| A4 | -1.124 mV | -0.075 percentage points | 4.474 ns |
| A5 | -0.998 mV | -0.067 percentage points | 4.430 ns |
| A7 | -0.398 mV | -0.027 percentage points | 4.434 ns |
| A9 | -1.345 mV | -0.090 percentage points | 4.442 ns |
| A11 | +0.539 mV | +0.036 percentage points | 4.343 ns |
| CASn | +0.932 mV | +0.062 percentage points | 4.312 ns |

This partial diagnostic predates the complete reduced-scope refinement above.
It and its timeout provenance are separate in `partial-spatial-prefix.json`.

The full 517-cell, 2 mm radius case also reached only its 4 ns saved
checkpoint: native time 1,200.067 s, sampled peak RSS 402.625 MiB. It provides
no complete peak/crosstalk comparison. The reduced radius experiment uses
the corrected quiet-driver control above.

## Driver, package and switching sanity checks

`scripts/addr-cmd-driver.py` reads the typical columns of the local vendor
I/V tables without committing them. At 0.75 V pullup drop, Model_352 sources
15.902691 mA: `R = 0.75 / 0.015902691 = 47.162 ohms`. The pulldown value is
47.164 ohms. A selector's nominal 50-ohm calibration label is not a constant
linear resistance across the entire I/V table.

For an ideal step into an isolated open-ended lossless line,
`Vlaunch = VDD * Zo / (Rdriver + Zo)` and the first far-end arrival is
`2 * Vlaunch`. Solving the *nonlinear* pullup table's launch load line gives:

| Line Zo | Effective driver R at launch | First far-end arrival | Predicted overshoot |
|---|---:|---:|---:|
| 50 ohms | 47.043 ohms | 1.54571 V | 3.047% |
| 65 ohms | 46.569 ohms | 1.74780 V | 16.520% |

The analogous falling-step excursions are 3.196% and 17.227%. These are
**hand estimates**, omitting finite slew, loss, input capacitance, clamps,
vias and packages. They do not explain a 31% inner-net median by themselves.
The existing 2D diagonal integrated L/C proxy is 52.36 ohms for A4 and
59.33/59.83 ohms for A9/A5; these proxies omit transitions and added oblique
C and are not measured or modal impedances.

The selected vendor package has A4-to-A9 mutual L = 3.158 nH, A4-to-A5
2.248 nH, A4-to-A3 2.239 nH and A4-to-BA0 2.270 nH. Simultaneous-switching
package coupling can therefore affect inner and outer routed nets alike.
These are package-model parameters, not extracted PCB coupling. The isolated
A4 TSX control holds **all other 23 drivers low**, including both clock legs.
Package-off replaces only package series R/L with micro-ohm links and removes
package C/mutual terms, keeping vendor die I/V, C_comp, clamp and ideal die-rail
models. Package-off is a diagnostic, not a possible board fix.

An algebraic check of the emitted original and failed reduced odd-victim
decks found no nonpositive self-inductors or duplicate mutual pairs. For
every mutual-connected component, the normalized L matrix (unit diagonal,
off-diagonal K values) is positive definite; the smallest eigenvalue is
0.339880. No component was skipped. This excludes an indefinite inductor
energy matrix in those two decks, not physical package/model errors.
`inductor-matrix-check.json` retains the deck hashes and counts.

### What the terminal controls can and cannot bound

All corrected quiet-victim peak errors in `terminal-inductance.md` are
negative (2D underpredicts): -5.883/-12.983 mV in the tight near/far cases,
and -2.702/-3.319 mV in the short near/far cases. Relative to the corresponding
fine-reference peaks, the largest residual is about 3.685% (3.319/90.077).
If that relative envelope transferred to A4, it would be 15.82 mV at
429.42 mV; even subtracting that amount leaves about 413.60 mV. This is
**conditional arithmetic, not a validated board-level error bound**.
The largest saved quiet waveform point error is 15.380 mV in those controls.
Their source, termination, geometry and excitation differ from this board.
No finite general crosstalk inflation bound follows from these partially
agreeing referee controls. In particular, radius truncation, oblique surrogates, package
assumptions and missing endpoint loads are not bounded by that 15.82 mV.
The known terminal correction alone offers no evidence that it creates a
400 mV spurious positive crosstalk result.

## Winbond peak and area limits

The local W631GG6MB datasheet A02 (2017-11-23), section 10.12.1, page 121,
was text-extracted and visually checked. The later [Winbond A03 datasheet,
section 10.12.1, page 122](https://media.digikey.com/pdf/Data%20Sheets/Winbond%20PDFs/W631GG6MB_A03.pdf)
has the same limits. These are **address/control** limits, not the smaller
DQ/clock area limits in section 10.12.2.

| Quantity | Verified W631GG6MB value | DDR3-800 qualification |
|---|---|---|
| Peak above VDD / below VSS | 0.4 V / 0.4 V in every listed column | No separate DDR3-800 column; applying the speed-independent peak ceiling is an explicit assumption |
| Addr/control area, DDR3-1333 | 0.40 V ns above / below rails | Verified for the printed column only |
| Addr/control area, DDR3-1600 | 0.33 V ns above / below rails | Verified for the printed column only |
| Addr/control area, DDR3-1866 / 2133 | 0.28 / 0.25 V ns above / below rails | Verified for the printed columns only |
| Addr/control area, DDR3-800 | **Not specified in these copies** | **Unverified; no extrapolated pass/fail** |
| Absolute any-pin voltage | -0.4 to 1.975 V (A02 section 10.1, p.98) | Independent absolute-rating comparison |

At nominal 1.5 V, the printed 0.4 V excursion ceiling corresponds to
1.9 V / -0.4 V. Twelve of the 22 command nets exceed 1.9 V in the saved
before capture, eight exceed 1.975 V, and none falls below -0.4 V. A9 reaches 2.092877 V, 192.877 mV
above 1.9 V and 117.877 mV above the absolute upper rating. A5's largest
positive lobe is 0.495778 V ns; its largest negative lobe is 0.217829 V ns.
A9's *sum* of positive lobes is 0.520941 V ns. A DDR3-800 area-compliance
claim cannot be made from a missing W631GG6MB table column.

## Physical feasibility and fix classes

`scripts/prepare-addr-cmd-routes.py` copies route data and patches matching
physical copper only. The A10 reference-relief delta is applied to the copied
route data before matching; ignoring it would silently miss A10. Original
board SHA-256 is `a42c0458378a91ac975c72af6e4e2c3c7f5d407ac8fb4fad5ac0434e2b52ecd7`.
No original board, route data or vendor IBIS is written or committed.

| Candidate | Change class | Physical feasibility evidence |
|---|---|---|
| Outer bodies widened from 0.10 to 0.18 mm on all 13 outer command nets, retaining necessary 0.10 mm neckdowns | Trace edit; AI-route-editable | Uniform widening adds 13 pad/trace and one via/trace clearance errors. Local stepped neckdowns around those obstacles restore exactly the original 118 findings. Electrical results use this corrected copy. |
| 50-ohm parallel resistors to ideal 0.75 V VTT at all 22 receiver balls | Components/topology and VTT supply | No route edit; no resistor-pad, escape or regulator/PDN model; clocks excluded. Firmware/board implementation remains separate. |
| Model_345: slow, 1.14 x RExt, 5% family | Firmware/calibration what-if | Selector_4 row verified in the local TI file; register readback/programming not verified. |
| Model_273: slowest, 1.00 x RExt, 5% family | Firmware/slew what-if | Same I/V tables as Model_352; different measured edge tables. Register implementation not verified. |
| BA2 body shifted +0.25 mm over its longest vertical span | Trace edit; AI-route-editable | A4/BA2 centre spacing increases 0.75 to 1.00 mm over their overlapping body; endpoints, layers and vias fixed. BA2 length increases 0.2071 mm. Routing checks retain exactly the original 118 findings, with no new findings. |

Routing checks use the supplied prototype's `@tscircuit/checks` 0.0.268.
The original 118 findings are 95 disconnected-port and 23 via-clearance
findings; “no new findings” does not mean a clean whole board. A preliminary
A4 shift increased A4/A8 spacing without adding findings, but A8 is also quiet
in the worst A4-victim experiment. The final candidate instead moves active
BA2 away from A4. Its BA2 reference-relief delta is applied before matching
the copied route, as well as the A10 delta. This targets a real aggressor/victim
pair; the package mutual terms are unchanged.

The width script uses each reported pad's bounding circle, with 0.75 mm
additional distance along the trace and 0.5 mm for selecting nearby segments.
It inserts explicit constant-width sections and co-located width-step vertices;
there is no unsupported linear taper. Narrow lengths are 4.095 mm (CSn0),
3.629 mm (CASn), 7.531 mm (A10) and 10.942 mm (RASn). Source paths, endpoints,
layers and vias stay fixed. Synthetic tests check width-step length/endpoints
and layer isolation; the routing check uses the actual copied board. The final
copy SHA-256 is `a47befc73e97330db43da0415278042cd51692b0790fd119ac344673a1ba884f`.

TI explicitly says a [single-x16 point-to-point AM335x DDR3 connection does
not require VTT](https://www.ti.com/lit/an/sprabn2a/sprabn2a.pdf), while discussing
VTT for larger topologies. The requested ideal receiver-ball termination is
therefore a topology what-if, not evidence that TI requires a fly-by/VTT
redesign of this board. Static VTT load, level swing and power must accompany
any ringing reduction; no regulator performance is simulated here.

## Reproduction and validation

All declarations and selectors originate in `tests/support/full-board-ddr3.tsx`.
Set `SI_DDR3_BOARD` and `IBIS_MODEL_DIR` to local read-only inputs. The staged
runner `bash scripts/run-addr-cmd-qualification.sh <stage>` runs serial native
experiments, retains individual failures and continues independent patterns,
then returns nonzero if a capture failed. Stages include `refine`, `radius`,
`scope-refine`, `scope-fine`, `scope-radius`,
`isolate`, `package-off`, `width`, `vtt`, `weak`, `slowest`, and `spacing`.
`refine-reduced` preserves the original signal-removal reproduction of the
inactive-buffer failure; it is not the corrected quiet-driver control.
The width/spacing stages require the copied boards prepared with
`scripts/prepare-addr-cmd-routes.py`; use `--width .18` or `--spacing .25`, plus
`--route-delta <source-folder>/data/cloud-a10-trace-reference-delta.json`.
The spacing stage additionally needs `--spacing-net BA2` and
`--route-delta <source-folder>/data/cloud-ba2-trace-reference-delta.json`.
Prepare the uniform width copy and run the prototype routing check first;
pass that report as `--neckdown-clearance-report <drc-width.json>` when
preparing the final width copy. `python3 scripts/prepare-addr-cmd-routes.test.py`
runs the independent synthetic profile tests without native tools.
Use the source's `data/cloud-ddr-routes.json` as the route-data input.
An optional `SI_ROUTE_FIELD_CACHE` points to a local saved geometry cache;
vendor data and large decks/fields stay ignored under `runs/`.

The summary script takes a JSON manifest of complete case directories and
comparison windows. It rejects incomplete native captures and writes compact
metrics, provenance and optional receiver overlays. Synthetic triangle and
split-lobe checks verify exact rail-crossing integration; these checks are
not native circuit evidence.

Lint, module rules, vocabulary and typecheck pass; lint retains the existing
535-line `src/extraction/mesh.ts` warning. With
`TSX_TSCONFIG_PATH=examples/tsconfig.json pnpm test`, 219 tests pass, 32 skip,
and the pre-existing `tests/extraction/mesh.test.ts:20` FastHenry plane-deck
assertion fails. The opt-in real-board scope/control file has four passing
tests; the copied-width profile file has two passing synthetic tests.
One stage-shell parse error occurred after both fine native captures had
completed; `orchestration-note.json` distinguishes that runner-edit error from
native failures. The runner was syntax-checked and frozen before subsequent
stages. `guard-failures.json` retains rejected captures separately from the
accepted metrics and compact provenance.

```mermaid
flowchart LR
  tsx[Original TSX signal declarations] --> controls[Named scope and isolated A4 controls]
  copy[Read-only board and copied route edits] --> controls
  controls --> guards[Exact-input extraction and native budgets]
  guards --> complete{Complete native capture?}
  complete -->|yes| metrics[Native extrema, censored settling and pulse areas]
  complete -->|no| failures[Retain failure evidence without waveform claims]
  metrics --> compare[Matched stimulus and scope comparisons]
  compare --> verdict[Model result and hardware uncertainty kept explicit]
```
