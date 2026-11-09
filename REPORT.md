# Round-1 remediation report

This is a **partial local implementation**, not a completed or qualified replacement pipeline.
Both blocker failure modes now have regressions and safe behavior. Findings 3, 8, 10 and 11
remain operationally unresolved. The current examples reject unsupported reference vias before
extraction; no new example eyes, crosstalk voltages or native determinism pass is claimed.
Nothing was pushed and no PR was opened. No subagents, dependency admission patches, solver
limits, lane caps, or new truncations were introduced.

## Branches

- `si-2d/repro` remains at `f2b3bb0ee3eeefdfe0016e68baa4f4b1ae8156ad`.
- All remediation commits are on `si-2d/fix`, above reviewed head `65fb57f`.
  The implementation snapshot is `4882761b2339ce2b7a4c13b36308242aa5f38c6f`; later changes only update this report/docs.
  The final delivery gives the resulting head (a report cannot contain its own commit hash).
- The original `tests/fixtures/rs485-gap.tsx` is restored byte-for-byte from the reproduction
  branch. New API regressions belong on the fix branch; the stack was not rebased.

## Findings and regression status

All names below are actual test titles or their unambiguous `review N:` prefixes. The three
remaining red tests execute as TODOs, rather than being silently skipped or treated as fixed.
Their ordinary failing runs are preserved in `runs/review-round1/open-red.log`.

| Finding | Status | Regression / evidence |
|---|---|---|
| 1, blocker: oblique driven copper floats | Fixed by explicit rejection, unit-only | `review 1: oblique driven lanes never become neutral floating copper`: `oblique_coupling` rejects driven copper without a propagation port. No approximation notice or zero-crosstalk result is returned. |
| 2, blocker: clean-package admission | Fixed, packed consumer verified | `review 2: actual settings-free TSX is admitted with an unpatched circuit-json peer`; `pnpm test:package` renders actual TSX, feeds its output to the installed package, and reaches the expected physical-geometry diagnostic. The existing complete in-memory consumer still runs. |
| 3: TI switching with supply L | Documented unsupported case; requested switching operation NOT DONE | Native-suite `review 3: real TI switching with inductive die supplies requires missing power-aware data` uses real vendor bytes and TSX electrical declarations. `ibis_supply_dynamics` refuses enabled output models with inductive reference pins. The synthetic buffer diagnostic also runs in the unit suite. This is not a native TI switching success. |
| 4: invalid/missing vendor package | Fixed, unit-only; input-buffer package still tested natively | `review 4: vendor policy rejects missing and negative R/L/C on every mapped TSX pin`; `review 4: explicit zero package values are valid rather than missing`. Each resolved metadata value is checked for presence, finiteness and nonnegativity before being emitted. |
| 5: sloping return geometry | Fixed by explicit rejection, unit-only | `review 5: sloping return boundaries never become one midpoint extrusion`: interval endpoint motion inside each vertex-bounded longitudinal interval raises `varying_cross_section`. A nonuniform approximation is not emitted. |
| 6: reference vias disappear | Fixed by explicit rejection, unit-only | `review 6: unselected reference via is never omitted`: every via outside selected signal-route models raises `reference_via`. This intentionally invalidates the examples' former incomplete geometry. |
| 7: pad overhang omitted | Fixed, unit-only | `review 7: endpoint pads include connected open overhangs`: the reviewer's 2 mm pads at +/-5 mm span -6..6 mm with connected open stubs and unchanged physical IN/OUT nodes. Added pad length is accounted for in segment metadata. |
| 8: finite-thickness skin transition | NOT DONE, executing red TODO | `review 8: skin transition agrees with the one-face finite slab at delta = thickness`: actual TSX copper drives the current extraction path; normalized result 1.628041175 versus independent slab 1.085635705, +49.96%. Improving the Foster fit does not fix its incorrect physical target. |
| 9: inaccurate fixed Foster fits | Fixed for supplied excitation-band samples, unit-only | `review 9: loss accuracy is contractual across the excitation band, with adaptive branch count`; `review 9: a non-Foster loss target fails explicitly instead of returning a bad fit`. Nonnegative pole intervals bisect until maximum sampled relative error <=2%, with strict weighting for every nonzero sample. Monotonicity/slope violations, a continuous-pole infeasibility certificate, or exhausted floating-point pole resolution raise `loss_fit`. Branch counts, maximum and RMS errors are logged and serialized. No branch ceiling exists. Continuous-band and physical eddy-current accuracy are not established by this test. |
| 10: RS-485 comparison | Fixture restored; numerical qualification NOT DONE, executing red TODO | `review 10: original 44 by 12 mm RS-485 comparison TSX stays reproducible`; `review 10: identical original RS-485 copper can be extracted for a qualified mutual-L comparison`. The original preset lacks loss tangent, and after material completion its unmodelled reference vias would still be rejected. No changed-board value is presented as an identical-geometry comparison. |
| 11: cold speed | NOT DONE, executing red TODO | `review 11: cold extraction of the original crosstalk TSX completes in seconds`. The full pipeline currently rejects geometry, so no cold-extraction speed pass exists. An optional-mesh-alignment experiment was measured and reverted; caching was not counted as a fix. |

The additional fitter regressions cover a known positive-real branch across twelve decades and a
nonconcave monotone target that satisfies the elementary slope bounds. The first exposed and fixed
premature coarse-grid rejection. The latter now gets a continuous-pole separating certificate:
normalized Foster columns have log-pole derivative in [-2,0], bounding the residual weighted-mean
interpolation error by range(residual)*log-gap/4. Explicit endpoint bounds cover poles outside the
grid; a separating dual vector proves when every positive Foster fit exceeds the 2% sampled error.
The declared pole interval is not treated as a proof of infeasibility. Tiny nonzero targets have
no peak-relative normalization floor. This certifies the sampled numerical fit, not a physical skin law.

## Precise limitations and closest sound alternatives

For finding 3, the wrapper connects classic IBIS dependent current sources to die supply inductors,
while C_comp is emitted only between PAD and the pulldown rail. The external C_pkg does not provide
a die-side supply storage path. At zero/negative switching coefficients the supplied voltage-clamp
model is not a qualified power-delivery model. The supplied TI file is IBIS 3.2 and provides neither
a power-aware supply-current model nor the split die capacitances needed to justify a new rail
storage network. The review already demonstrated that coefficient clamping, smoothing and moving
package capacitance do not qualify a fix. This work does not establish the unique physical cause
of the vendor abort and does not invent damping, capacitance allocation or new vendor data.
The closest sound implemented alternative is `ibis_supply_dynamics`; explicitly omitted package
parasitics remain an ideal-supply experiment. Input-buffer package operation is a narrower native
check. Full switching support requires additional model data and a qualified converter.

For findings 1, 5 and 6, connected nonparallel current paths, continuously changing cross-sections,
and reference-via return connectivity are not determined by the present independent prismatic
slice assembly. A local floating-neutral Schur reduction cannot replace a driven port. Vertex
cuts cannot make a sloping boundary constant. A lumped signal-via formula cannot account for the
longitudinal network formed by reference vias, planes and clearance holes. Diagnostics are the
implemented sound alternative explicitly permitted by the review. Supporting the existing examples
again requires a connected nonuniform/discontinuity model; deleting their copper to obtain a run
would change the requested experiment and was not done.

Finding 8 is **not physically impossible**; its implementation is incomplete. A validated
finite-thickness surface-impedance or eddy-current solve must account for individual conductor
thickness/conductivity and opposing-face/proximity currents. Replacing the global transition
frequency with another scalar blend cannot establish that accuracy. The known bad loss law
remains in the existing extractor, explicitly exposed by the red TODO. It must not be used for
qualified finite-thickness predictions. The closest sound analytical reference for the reproduced
case is Re[(1+j)coth(1+j)] = 1.085635705. A general passive multi-conductor replacement has not
been implemented; this report does not label that task infeasible or fixed.

For finding 11, the candidate limited optional panel projections to active conductors and a wide
reference while retaining every physical boundary and the 0.5% entry-wise convergence test.
A historical TSX-derived slice fell from 1,600 to 1,088 panels and solved in 1.367 s. That did not
qualify the algorithm: the difficult historical slice 214 remained unconverged at 4,352 panels
(estimated residual 2.360%) and its next refinement was still running after five minutes. The
experimental solve was manually interrupted, with no result used or cached; the candidate mesh
change was reverted. This is a bounded failed experiment, not a production timeout or a hidden
attempt cap. `src/extraction/bem.ts` is unchanged from the reviewed branch. Adaptive local field
refinement or a layered Green-function method remains necessary. No speed claim is made.

## Verification commands

Final command outcomes are recorded below and in ignored `runs/review-round1/` logs. The command
with pinned vendor assets intentionally exercises the currently unsupported real examples.

| Command | Result | Evidence / scope |
|---|---|---|
| `pnpm build` | PASS | `build-verified.log` |
| `pnpm test` | PASS with open work | 261 tests: 258 pass, 0 ordinary failures, 3 executing failing TODOs; 157.640 s. `test-final-verified.log`. The TODOs are findings 8, 10 and 11. |
| `pnpm test:native` | PASS, limited | 6 pass, 2 skip; 5.027 s. No vendor directory was supplied for this command; its two vendor-dependent tests are skipped. `native-basic-verified.log`. |
| `PCB_SPICE_TEST_MODEL_DIR=runs/2d-models pnpm test:native` | FAIL | 7 pass, 1 fail; 6.462 s. The actual vendor-example test raises `reference_via`. The isolated real-TI converter diagnostic passes, without claiming a switching waveform. `native-vendor-verified.log`. |
| `pnpm test:package` | PASS | Clean, unpatched circuit-json@0.0.541 consumer: Node/Bun imports, complete in-memory run, actual settings-free TSX admission, denied-host run, NodeNext declarations. `package-verified.log`. |
| `pnpm lint` | PASS | `lint-verified.log` |
| `pnpm check:modules` | PASS | `modules-verified.log` |
| `pnpm check:vocabulary` | PASS | 89.8% overall versus 85% contract; `vocabulary-verified.log` |
| `pnpm typecheck` | PASS | Production and test types; `typecheck-verified.log` |
| `node --import tsx scripts/verify-review.mjs` | All ten attempts rejected | Fresh processes, five cases twice, zero native example invocations. `cold-attempts.json` / `cold-attempts.log`. |

Logs are under `runs/review-round1/`. The fit metrics are `fit-metrics.jsonl`; initial failing
regressions are `si-review-red.log`, `si-package-red.log`, `supply-red.log`, `loss-red.log`,
`loss-tiny-red.log` and `open-red.log`. The failed mesh experiment is `scaling-worst.log`;
it has no final numerical result. Golden artifact hashes were deliberately regenerated for the
new fit networks and revised geometry-qualification notices. Earlier aborted/failed intermediate
test logs are retained separately and are not the final command results.

Admission now owns its electrical channel schema, including strict rejection of removed settings,
and its unlimited bit-pattern schema inside this package. The `circuit-json` patch and workspace
entry are removed. Validation keeps the upstream experiment refinements by validating a copy
without channel intent, then validating the package-owned intent separately; input bytes are not
rewritten. Remaining core/props/converter patches predate this remediation and are not admission
schema patches.

The geometry success tests now use a supported parallel TSX fixture for lengths and lane-order
invariance. The old example assertions explicitly test the new diagnostic. The source-net-binding
unit test derives its mapping from actual TSX ports/traces and tests electrical connectivity alone;
it no longer conflates that check with unsupported reference-via field extraction. These changes
do not turn an unsupported board into a qualified field result.

## Cold timings and native example attempts

Each new attempt is a separate process, without restored or process-local field caches. Timing
starts after TSX rendering and vendor-asset loading. Every example was attempted twice with an
actual native ngspice adapter configured. All ten attempts reject `reference_via` before extraction,
and invoke ngspice zero times. Their diagnostic codes/messages agree across repeats. This is
**not** native waveform determinism and the short rejection times are **not extraction times**.
Reproduce with `node --import tsx scripts/verify-review.mjs`.

| Board | Historical 65fb57f cold extraction s | Current cold extraction s | Current pre-extraction rejection s, first / repeat | Native runs completed |
|---|---:|---|---:|---:|
| single-ended | 52.356 | N/A | .142826 / .041495 | 0 / 2 attempted |
| differential-data | 1609.389 | N/A | .026814 / .033837 | 0 / 2 attempted |
| crosstalk, active | 4144.831 shared geometry | N/A | .033930 / .027160 | 0 / 2 attempted |
| crosstalk, quiet | 4144.831 first quiet solve | N/A | .035988 / .026040 | 0 / 2 attempted |
| multilayer | 653.178 | N/A | .021005 / .023407 | 0 / 2 attempted |

Historical rows are retained from the reviewed report, not rerun as if they were new results.
The original native 3D BEFORE extraction was 89.113 / 11.603 / 234.089 / 491.585 s for single,
differential, crosstalk and multilayer respectively; those comparisons changed model/return choices.

## Accuracy and loss checks

C/L closed-form checks retain the original independent 2% tolerances and oracles. BEM was restored
unchanged after the failed speed experiment. Historical numerical errors below are provided for
context; the latest tests establish the same <2% bounds rather than a new board-level validation.
These are unit-only cross-section checks, not native full-board qualifications.

| Configuration | Historical Z/effective-er error | Historical L12 / C12 error | Current qualification |
|---|---|---|---|
| single microstrip | -.2155% / +.1246% | N/A | independent 2% unit test |
| single stripline | +.1059% / ~0% | N/A | independent 2% unit test |
| coupled microstrip | Ze -.1580%, Zo -.1949%; ee +.2824%, eo -.1915% | +.3322% / -.3022% | independent 2% unit test |
| coupled stripline | Ze -.1555%, Zo -.2634%; er ~0% | +.1329% / +.5537% | independent 2% unit test |
| one-face slab at delta=t | expected R/Rdc 1.085635705; implemented normalized transition 1.628041175 | +49.96% | FAIL, red TODO 8 |

Adaptive-fit regression: 161 logarithmic samples, 2 MHz..1 GHz. These targets test the numerical
network approximation independently of the unqualified skin-transition law.

| Target | Adaptive branches | Maximum relative error | Relative RMS | Status |
|---|---:|---:|---:|---|
| sqrt(f) | 13 | .150078% | .079674% | unit-only, passes 2% sampled criterion |
| 2*pi*f | 13 | .210414% | .111611% | unit-only, passes 2% sampled criterion |

References retained by the tests: Hammerstad–Jensen microstrip/coupled microstrip, Wheeler stripline,
Cohn coupled stripline and TI via formulas. The review's finite-thickness reference is
[NBS conductor-loss analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC6752653/).

## Mutual inductance on identical geometry

| Geometry and method | External mutual L | Realized mutual L at 777240.733 Hz | Status |
|---|---:|---:|---|
| Original restored 44x12 mm TSX, old straightened 3D | 11.716323 nH | N/A | historical native baseline |
| Same original TSX and ports, old routed real-copper 3D | 4.169378 nH | N/A | historical native baseline |
| Same original TSX and ports, current 2D | N/A | N/A | NOT DONE; material/reference-via diagnostics |
| Different default-board geometry at reviewed 65fb57f, 2D | 1.504064 nH | 1.565388 nH | historical, unqualified; not the original geometry |

The last row's -62.73% comparison to 4.2 nH does not isolate geometry from method. A quantitative
same-geometry explanation remains open. Restoring the fixture prevents losing that work list.

## Eye height and width

No new eye was produced by the current examples. Values from the earlier reviewed candidate are
explicitly historical and cannot be used to claim the new code completes native simulation.

| Board | Historical BEFORE height / width | Reviewed 65fb57f height / width | Current candidate |
|---|---|---|---|
| single-ended | 3.299992 V / .832434 UI | 3.299976 V / .933093 UI | N/A, rejected before ngspice |
| differential-data | 4.470763 V / .785567 UI | 4.471156 V / .785584 UI | N/A, rejected before ngspice |

The previous width changes were 5.033 ns and 66.8 ps respectively, with geometry, segmentation and
loss laws changed together. They do not attribute an improvement to this remediation.

## Code size

| Comparison, production `src/` only | Added | Removed | Net |
|---|---:|---:|---:|
| Current candidate versus `main` | 1325 | 1752 | -427 |
| Current candidate versus `si-2d/repro` | 1325 | 1752 | -427 |
| This remediation versus reviewed `65fb57f` | 117 | 53 | +64 |

Counts are standard `git diff --numstat REF -- src/` sums, including the generated diagnostic union.
The unsuccessful BEM optimization is absent. Removing the circuit-json patch additionally deletes
1,485 lines outside `src/`.

The archived report and its detailed native measurements remain available in Git at `65fb57f:REPORT.md`.
This report supersedes their operational status for the current branch.
