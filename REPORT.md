# Round 3: sparse solver candidate; end-to-end goal NOT achieved

This round changes the technical approach: the dense logarithmic BEM field solver is deleted and
replaced with a conservative sparse finite-volume Laplace solver. **This is an incomplete candidate,
not a qualified replacement or a working five-example system.** Work remains local on `si-2d/fix`;
there was no push, PR, merge, dependency patch, subagent, pipeline timeout, attempt cap or lane cap.

The measurable blocker after changing solver is still transverse surface-current convergence and
its resulting grid size. The original single-ended board's first slice completed in **59.687 s**,
ending at **1,054,296 dielectric cells**. A separate nested-grid candidate reached **2,061,312 cells**
with surface-matrix change **0.546166%**, then exhausted Node's default heap. The requested
field-energy adaptive refinement is not implemented. Per the round's stopping instruction, further
solver tuning and longitudinal implementation stopped after these measurements. The remaining
independent verification was performed; interrupted commands below are not passes.

The starting head was `3c72059`, reproduction remains `f2b3bb0`. The final response supplies the
resulting head SHA. Historical round-2 evidence/report remains at `3c72059:REPORT.md`. New execution
logs are in `runs/review-round3/` (ignored local evidence, not published).

## Steps 1–3

| Step | Status | Evidence / remaining work |
|---|---|---|
| 1: sparse C/C0 solver | PARTIAL, candidate | Sparse nested-dissection LDL, shared factorization, exact metal faces, layered dielectric/mask cells, energy C/loss, flux-derived current distribution, floating-conductor Schur complement, independent grid/domain growth and nodal Gauss-balance guard implemented. `sparse Laplace factor preserves Gauss balance for every actual TSX conductor excitation` passes. |
| 1: adaptive refinement / accuracy / seconds | NOT COMPLETE | Geometric grading plus global density refinement is retained; energy-error adaptive refinement is absent. The 2% Hammerstad–Jensen/Wheeler/Cohn tests remain unchanged. Full coupled qualification did not complete within the bounded validation exercise; detailed evidence below. |
| 2: longitudinal staircase / oblique coupling / 1 µm hashing | NOT DONE | Existing `oblique_coupling` and `varying_cross_section` guards remain. No driven neighbour was converted to floating copper, no sloping boundary was silently treated as uniform, and no geometry was changed to manufacture a successful run. Exact slice hashing remains. |
| 3: required native example qualification | NOT DONE | Basic native suite passes on its stated fixtures. Four geometry-blocked cases were attempted twice in fresh processes and rejected identically. No new complete vendor example, eye comparison, native byte determinism, NEXT/FEXT permutation result or original-board mutual-L result is claimed. |

Finding 3 (`ibis_supply_dynamics`) remains unchanged. The existing native primitive coupled RLGC
ladders, automatic cell count, finite-slab Foster R(f), dielectric Foster G(f), no-lane-cap behaviour,
actual TSX reproductions and original RS-485 geometry are retained.

## Sparse method and limits

The cell-centred finite-volume graph uses harmonic displacement-flux weights
`w = face_length / (half_cell_a / er_a + half_cell_b / er_b)`. A metal neighbour supplies a Dirichlet
face at the physical rectangle boundary, rather than at its cell centre. Dielectric layers, mask,
board edges and drilled dielectric voids enter the physical cell map. The resulting symmetric
sparse operator is factored once per material/vacuum grid, with Float64 numerical storage and
nested-dissection ordering; all full-system conductor excitations reuse the factorization.
Small conductor matrices still use the existing dense backend; there is no dense field matrix or
logarithmic panel kernel. The sparse triangular factors use CSC storage.

Conductor capacitance is the bilinear face energy, `Cij = epsilon0 sum(w * deltaVi * deltaVj)`.
Weighted material-energy sensitivity gives dielectric loss directly, eliminating the old additional
perturbed-permittivity field solve. Vacuum face fluxes, transformed by C0 inverse, give the
surface-current covariance for the existing finite-thickness loss model. L remains
`mu0 * epsilon0 * inverse(C0)`. Floating metal is neutral and eliminated, not grounded.

The outer boundary has zero normal displacement, enforcing total conductor-charge neutrality.
Its extent doubles until the published matrices change below 0.5%, independently of mesh density.
C/C0/L and dielectric loss are compared directly; surface matrices retain a corner-error
extrapolation and log both raw and estimated changes. **The extrapolation and coupled surface
accuracy on this new graded grid are not fully qualified.** Grid and domain convergence are
necessary stopping checks, not a claim of independently established general skin/proximity accuracy.
A nodal Gauss-balance residual above 1e-8 raises `mesh_convergence` instead of returning a poorly
solved field. There is no iteration or refinement limit.

The mesh is geometry-graded rather than energy-adaptive. Refining its Cartesian product still
spends cells far from useful field energy; this is the unresolved algorithmic issue. The legacy
`steps.panels` field now counts dielectric cells; `kind` distinguishes mesh/domain and `extentMm`
records domain growth. Old field checkpoints without both convergence phases are rejected.
Golden artifact hashes were deliberately updated for the new field values and convergence records;
this is a numerical behaviour change, not byte compatibility with the BEM.

## Bounded measurements

These are **candidate slice measurements**, not complete cold-example extraction timings.
The first-slice benchmark precedes the added independent Gauss-balance guard and the correction to
raw-domain logging; electrical matrix generation is the same. Its process overlapped a short build,
so it is raw wall-time evidence, not an isolated final-head speed certification.

| Measurement | Result | Scope |
|---|---:|---|
| Single microstrip, sparse IC-PCG prototype | 18.090 s | One mathematical cross-section; stopped using this linear backend |
| Same microstrip, sparse direct LDL | 6.026 s | C/C0 agree with PCG to floating-point precision; not a board timing |
| Original single-ended first slice, sparse direct LDL | 59.687 s | Completed slice; no ngspice invocation in this measurement |
| First-slice grid convergence | 20.774 s; 987,232 cells | Max published estimate change 0.402935%; raw C 0.198683%, C0 0.219302%, raw surface-class max 2.537877% |
| First-slice domain 52 → 104 → 208 mm | final 1,054,296 cells | Domain max published change 1.316524% then 0.357622%; C0 changes 0.024495% then 0.006548% |
| Coupled microstrip, alternative nested quartic grid | 2,061,312 cells, still 0.546166% | Default Node heap allocation failure at ~131 s in the multi-case worker; failed candidate discarded |

The metric-grid coupled check also remained unconverged at 569,676 cells: raw C/C0 entries were
below 0.5%, but the total surface covariance estimate changed 1.568983%. This is a surface-current
qualification and adaptive-grid problem, not evidence that the 2% closed-form formulas are wrong.
No tolerance was changed and no incomplete field was inserted into a native board run.

## Cold example attempts and determinism

`SI_REVIEW_DIRECTORY=runs/review-round3 SI_REVIEW_CASES=differential-data,crosstalk,crosstalk-quiet,multilayer node --import tsx scripts/verify-review.mjs`
ran eight fresh workers, with pinned local real vendor bytes and the native adapter. Their
`nativeInvocations` are all zero. Rejection times include pre-extraction admission/binding;
**they are not extraction timings**. The code/message agrees between fresh repeats for each case.

| Example | Complete cold extraction, run 1 / run 2 | Rejection wall time, run 1 / run 2 | Current result |
|---|---|---:|---|
| single-ended | N/A / not run | N/A | First-slice-only benchmark above; vendor native suite interrupted during the actual-board test |
| differential-data | N/A / N/A | .012388 / .012470 s | `varying_cross_section` |
| crosstalk active | N/A / N/A | .011655 / .011610 s | `oblique_coupling` |
| crosstalk quiet | N/A / N/A | .011323 / .011350 s | `oblique_coupling` |
| multilayer | N/A / N/A | .008074 / .008343 s | `varying_cross_section` |

There is **no qualified five-case cold timing table**, no two completed fresh native runs for any
example and no new native artifact-determinism pass. The golden test does verify byte-identical
repeated in-memory artifacts with a canned waveform solver; that is narrower synthetic evidence.

## Eyes, crosstalk and identical-board mutual L

| Board | Historical main/before eye height / width | Current native eye height / width | Change |
|---|---|---|---|
| single-ended | 3.299992 V / .832434 UI | N/A / N/A | Not measured |
| differential-data | 4.470763 V / .785567 UI | N/A / N/A | Not measured |

| Crosstalk case | Current native NEXT | Current native FEXT | Lane-order permutation |
|---|---|---|---|
| active middle line | N/A | N/A | Not reached |
| quiet middle line | N/A | N/A | Not reached |

| Identical original 44×12 mm RS-485 copper/ports | External mutual L | Difference |
|---|---:|---|
| Historical real-copper 3D | 4.169378 nH | Baseline, not rerun |
| Current 2D | N/A | Cannot quantify: `varying_cross_section` remains |

The 11.716323 nH straightened historical result used a different geometry and is not a new identical-
board comparison. No new 2D/3D discrepancy explanation is justified without completing extraction.

## Commands and test evidence

| Command / check | Result | Scope |
|---|---|---|
| `pnpm build` | PASS | Production bundle/declarations, `build.log`; also rebuilt by native/consumer commands |
| `pnpm test` | INTERRUPTED / exit 1 | 124.773 s; 259 pass, 1 cancelled file (`tests/extraction/bem.test.ts`), 2 existing executing TODOs; no whole-suite pass. `test.log` |
| Full `bem.test.ts` + `loss.test.ts` attempt | INTERRUPTED | Coupled qualification incomplete; no skipped/relaxed 2% assertions. `accuracy.log` |
| Focused unchanged isolated accuracy tests | PASS, unit-only | 5 tests: Hammerstad–Jensen microstrip, Wheeler stripline, strict entry residuals, actual TSX convergence, FR4/mask energy/loss. `accuracy-focused.log`; coupled Hammerstad–Jensen/Cohn qualification remains incomplete |
| New sparse Gauss balance + singular reference + docs/import focused checks | PASS | 8 tests, `focused.log`; actual three-lane TSX fields and discrete maximum principle |
| Existing finite slab / opposing-strip proximity regression | PASS, unit-only | `review 8: actual TSX opposing strips reproduce the published one-face proximity loss within 2%`, `review 8: skin transition agrees with the one-face finite slab at delta = thickness`; full-suite completed records in `test.log` |
| Final golden update/determinism check | PASS, synthetic | 2 tests, 22.409 s; identical repeated in-memory artifacts with the canned waveform solver. `golden-update-final.log` |
| `pnpm test:native` | PASS, limited | 6 pass, 2 vendor skips, 17.710 s; `native-basic.log`; includes real extraction→ngspice on the in-memory fixture, primitive multiports, Foster branches and 12 lanes |
| `PCB_SPICE_TEST_MODEL_DIR=runs/2d-models pnpm test:native` | INTERRUPTED / exit 1 | Two native fixture tests completed; actual vendor board test did not complete; stopped at 84.516 s (2 pass, 1 cancelled). `native-vendor.log` |
| Vendor-enabled focused `review 3` guard | PASS, diagnostic-only | 1 test, 1.655 s; admitted real TI bytes retain `ibis_supply_dynamics`. `native-vendor-guard.log`; no switching success claimed |
| `pnpm test:package` | INTERRUPTED / exit 130 | Packed Node complete run, denied-host cold run and NodeNext declarations passed; Bun consumer still executing after >80 s and manually stopped. `package.log` |
| `pnpm lint` / `pnpm check:modules` | PASS | New sparse code and existing module ownership contract |
| `pnpm check:vocabulary` | PASS | Overall 88.9%, unchanged 85% requirement |
| `pnpm typecheck` | PASS | Production/tests; `typecheck-final.log` |
| Eight fresh geometry-blocked workers | expected rejections | `cold-attempts.json`, `cold-progress.log`; no native example completion |

## Production source size

| `git diff --numstat REF -- src/`, including the new grid source | Added | Removed | Net |
|---|---:|---:|---:|
| Versus `main` | 1,501 | 1,752 | -251 |
| This round versus `3c72059` | 293 | 224 | +69 |

The retained source uses the faster metric grid and exact sparse LDL. The failed nested-grid and
IC-PCG candidates exist only as ignored local evidence. This branch is not ready to claim the round's
success criterion: energy-adaptive transverse refinement, coupled surface qualification,
longitudinal staircase and all requested native example/comparison measurements remain open.
