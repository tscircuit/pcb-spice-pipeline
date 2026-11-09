# Round-2 implementation report

**The overriding end-to-end/speed goal is NOT achieved.** This is a tested local increment on
`si-2d/fix`, with no push, PR, merge, dependency patch, subagent, pipeline timeout, attempt limit,
lane limit or numerical-tolerance relaxation. Reference vias now enter the physical slices;
finite-thickness losses replace the heuristic. Further geometry diagnostics and dense-mesh cost
still prevent all five requested native example runs. No new board eyes, NEXT/FEXT voltages,
native waveform determinism, or identical-board 2D mutual inductance are claimed.

The reproduction branch remains `f2b3bb0`. This round starts from `4ea0eef`; the final response
provides the resulting head SHA. Earlier evidence remains under `runs/review-round1/`, with the
reviewed historical report available at `65fb57f:REPORT.md`. New local evidence is under
`runs/review-round2/` (ignored execution artifacts, available in this checkout).

## A–E status

| Item | Result | Actual regression/evidence |
|---|---|---|
| A: reference vias | Implemented, unit-only; full-board qualification incomplete | `review 6: reference stitching via records its net/layers and only changes intersecting slices`; `review 6: an electrically unclassified non-route via still raises reference_via`; `review 6: all four examples classify reference vias without reference_via rejection` |
| B: seconds / no solve over one minute | NOT DONE | CPU profile, three reverted mesh/window candidates, bounded single-ended attempts below; `review 11: cold extraction of the original crosstalk TSX completes in seconds` remains an executing failing TODO |
| C: finite thickness | Implemented and unit-verified in the stated slab/proximity limits; no board waveform qualification | `review 8: skin transition agrees with the one-face finite slab at delta = thickness`; `review 8: finite slab remains accurate from DC through the skin regime without a shared transition`; `review 8: actual TSX opposing strips reproduce the published one-face proximity loss within 2%` |
| D: identical original RS-485 | Material completion done; numerical comparison NOT DONE | `review 10: original 44 by 12 mm RS-485 comparison TSX stays reproducible`; `review 10: identical original RS-485 copper can be extracted for a qualified mutual-L comparison` remains an executing failing TODO, now failing on `varying_cross_section` |
| E: TI inductive supply package | Bounded native failure reproduced; sound fix not established | `review 3: real TI switching with inductive die supplies requires missing power-aware data`; two isolated native supply experiments below; `ibis_supply_dynamics` retained |

Findings 1/2/4/5/7/9 retain their earlier protections. The former broad reference-via rejection is
replaced by electrical classification. Tests that previously expected that broad rejection now
expect the actual next geometry diagnostic; this does not qualify those boards for extraction.

## Reference geometry and physical loss model

Reference vias are identified through the source trace or electrical connectivity key. Ground and
ideal-DC supply copper remain equipotential references, while their distinct physical net identities
are retained for short detection. `geometry.referenceVias` records each stitch's physical net,
layer/pad spans, drill, plating and barrel span. Cuts include circular pad/barrel/drill tangencies
and centre. At each intersecting slice, exact circular chords form hollow barrel and pad rectangles;
the drill removes actual copper and dielectric, and existing polygon voids retain their antipads.
Copper unions prevent double-counting area and suppress internal pad/barrel/pour BEM faces.
Unclassified non-route vias still raise `reference_via`.

This remains a **local midpoint quasi-TEM model**. Longitudinal integration of changing circular
chords has not been independently converged, and no 3D via-fringing accuracy is established.
The via field regression verifies a nonzero capacitance change and the unchanged 0.5% entry-wise
BEM convergence requirement. It does not establish a native complete-board return-path result.

The skin target is now the finite slab surface impedance
`Zs = gamma*coth(gamma*t)/sigma`, `gamma=(1+j)/delta`, from
[NBS J. Res. 84 (1979), 247, eq. 2.3](https://nvlpubs.nist.gov/nistpubs/jres/84/jresv84n3p247_A1b.pdf).
Its exact DC term is subtracted, then its excess is weighted by the PEC surface-current covariance
and added to the area-based DC resistance. Each physical thickness/conductivity class has its own
Foster fit and convergence entries; the shared maximum transition frequency and empirical blend
are removed. Stable low-frequency series evaluation avoids cancellation. Identical material fits
and the common dielectric fit are reused within extraction. Netlists and spectra consume every
`skin.terms` entry; no aggregate matrix/first-fit alias misrepresents mixed materials. Old field
checkpoints without the physical surface terms are rejected. The existing numerical fit contract
still requires <=2% maximum relative error over every supplied excitation-band sample.

This is a perturbative one-face surface-impedance treatment, not a bulk eddy-current solve.
General frequency-dependent redistribution between opposing faces and arbitrary proximity geometry
has not been independently qualified. The added proximity benchmark uses actual TSX opposing wide
strips and NBS eq. 3.3's facing-current limit, rather than claiming a general coupled-strip data set.

| Loss check | Independent target | Current result | Scope |
|---|---:|---:|---|
| One-face slab, delta=t, R/Rdc | 1.085635705 | 1.085539898 (-0.00883%) | fitted target; 25 branches, max sampled excess-loss fit error 0.651705% |
| Opposing strips, t/delta=10, R per metre | 0.492610837 ohm/m | 0.497970017 ohm/m (+1.08791%) | TSX-derived surface-current solve, 2% oracle / 0.5% mesh criterion |
| Single/coupled microstrip and stripline C/L/modes | Hammerstad–Jensen, Wheeler, Cohn | existing 2% assertions pass | independent unit cross-section checks; tolerances unchanged |

Numbers are in `loss-metrics.json`. Finite width/fringing is present in the second row's actual
geometry and absent from the wide-strip oracle. Neither row is a native waveform measurement.

## Bounded speed work

Before changing the solver, a fresh historical crosstalk slice took 3.9564 s and 1,696 panels.
The V8 profile sampled approximately 37% in WebAssembly LU, 35% in the logarithmic primitive and
18% in the remaining panel kernel. LU was already IEEE-double WebAssembly; replacing JS arrays
alone would not address the panel explosion.

| Experiment | Measured result | Disposition |
|---|---|---|
| Restrict optional projection alignment | first benchmark still running after 69 s | manually stopped, reverted |
| Exact Galerkin panel primitive | 5.3477 s versus 3.9564 s; same final panel count | reverted |
| Converged growing lateral windows on the same slice | 10.9855 s, finally 0.1072% entry change; no useful panel reduction | reverted |
| Cost-selected windows on new via-heavy single-ended slice | did not reduce this first slice; still unconverged at 4,832 panels | manually stopped, reverted |

No failed candidate, truncated field, cached result, fixed window, or relaxed criterion is shipped.
The retained fit reuse avoids repeating identical fitting work, but is **not a demonstrated fix
for whole-board cold extraction**. Local panel refinement / a layered Green-function or higher-order
field discretization is still required. New reference-via rectangles make the first single-ended
slice especially expensive; merely allowing the geometry is not a speed success.

## Cold attempts and determinism

All workers are fresh Node processes with real pinned vendor bytes and a native-ngspice adapter.
The four geometry-rejecting cases were attempted twice by `scripts/verify-review.mjs`. Single-ended
was also attempted twice and manually stopped as a bounded measurement after exceeding the target;
there is no such stop rule in the pipeline. Verification shared CPU with the repeat, so **no
qualified cold-extraction wall-time table exists**. The progress/rejection figures below are raw
evidence, not successful extraction timings. No example reached native ngspice (0/10 attempts).

| Board | Completed cold extraction, first / repeat | Raw progress or rejection seconds, first / repeat | Outcome |
|---|---|---:|---|
| single-ended | N/A / N/A | >63.845 / >35.241 (last logged field steps, not interruption times) | first slice unconverged; 4,832 / 2,416 panels at last log |
| differential-data | N/A / N/A | .027673 / .024197 | `varying_cross_section` |
| crosstalk, active | N/A / N/A | .021792 / .025249 | `oblique_coupling` |
| crosstalk, quiet | N/A / N/A | .024750 / .024732 | `oblique_coupling` |
| multilayer | N/A / N/A | .016615 / .014579 | `varying_cross_section` |

The rejection code/message is identical across each of the eight completed attempts. The initial
single-ended mesh coefficients/residuals also agree at matching refinements, but no completed
extraction or native byte-determinism pass is claimed. `cold-attempts.json`, `cold-progress.log`,
`single-attempt.log` and `single-repeat-attempt.log` retain these distinctions.

After A, the actual blockers are the sloping termination/interconnect cross-section in RS-485,
a driven oblique crosstalk route, and a varying multilayer slice. Their diagnostics were not bypassed,
and no trace, pad, pour or port was deleted or rerouted to manufacture a successful example.

## Eyes, crosstalk and identical-board mutual L

Historical baseline values below are retained evidence, not reruns of main in this round.

| Board | Historical main/before eye height / width | Current eye height / width | Current change |
|---|---|---|---|
| single-ended | 3.299992 V / .832434 UI | N/A / N/A | not measurable |
| differential-data | 4.470763 V / .785567 UI | N/A / N/A | not measurable |

| Crosstalk experiment | NEXT | FEXT | Lane permutation / native determinism |
|---|---|---|---|
| active middle line | N/A | N/A | geometry rejection stable; no native result |
| quiet middle line | N/A | N/A | geometry rejection stable; no native result |

| Identical original 44x12 mm RS-485 copper/ports | External mutual L | Current difference vs 4.2 nH |
|---|---:|---|
| Historical routed real-copper 3D | 4.169378 nH (reported rounded as 4.2 nH) | historical baseline |
| Historical straightened 3D | 11.716323 nH | historical comparison |
| Current 2D | N/A | NOT DONE: `varying_cross_section` |

The original TSX copper and ports remain intact. Its explicit stackup completes the original preset:
30 um outer copper, 1.43 mm core, Dk 4.42, sigma 5.8e7 S/m, plus declared loss tangent .02 and via
plating .025 mm. Only the last two fields complete missing physical data. Loss tangent affects G,
not the vacuum C0-derived external mutual L. There is no missing-loss-tangent excuse for the absent
L comparison: the remaining execution blocker is the changing geometry. The historical changed-board
1.504/1.565 nH values are not presented as the original-board comparison or attributed to this round.

## E: bounded native supply experiment

The admitted TI CMOS file SHA-256 is
`03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00`, IBIS 3.2. It supplies neither
split rail-referenced C_comp values nor `[Composite Current]`; the actual example declares no board
decoupling capacitor. Nodal die storage cannot be inferred from external C_pkg or assigned by guess.
The existing simulation already selects Gear. No capacitance, damping, coefficient clamping, tighter
reltol or altered vendor bytes were introduced as a purported fix.

Two native experiments use the previously generated TI output wrapper, a 1 kohm / 5 pF signal load
and 3.3 V supply, isolating package behavior from board extraction. This is diagnostic evidence,
not an end-to-end example or a new power-aware IBIS converter.

| Native ngspice case | Samples | Last time | Result |
|---|---:|---:|---|
| Vendor supply R/L/C, method=gear | 2,016 | 100.0000000004 ns | `Timestep too small`, aborted |
| Explicit ideal-supply-L control | 54,874 | 1.6 us | completes, -0.150..3.339 V switching |

Ngspice returned process code zero even for the truncated vendor run; the abort message and final
time were inspected. `supply/data-audit.json`, `supply/results.json` and the two native logs preserve
this. The production `ibis_supply_dynamics` guard remains. Additional physical supply-current/die-rail
storage data and a qualified converter remain necessary; these experiments do not prove a unique
cause or justify inventing that data.

## Verification

The full-suite exit status includes two executing red TODOs, rather than silently skipped
requirements. New artifact hashes were deliberately regenerated for the via metadata/unions,
finite-thickness terms, primitive labels and explicit approximation notices. The golden suite
still asserts byte determinism across repeated in-memory runs; that is synthetic-solver evidence.

| Command | Result | Evidence and scope |
|---|---|---|
| `pnpm build` | PASS | `build.log`; production bundle/declarations |
| `pnpm test` | PASS, two open TODOs | 266 tests: 264 pass, 0 ordinary failures, 2 executing failing TODOs; 183.865 s. `test-final.log` |
| `pnpm test:native` | PASS, limited | 6 pass, 2 vendor skips, 14.596 s; `native-basic-final.log`. Primitive multiports, fitted branches and in-memory extraction execute native ngspice; no example qualification. |
| `PCB_SPICE_TEST_MODEL_DIR=runs/2d-models pnpm test:native` | MANUALLY INTERRUPTED, not PASS | `native-vendor.log`: two native fixture tests completed; slow single-ended field extraction was interrupted before its native invocation. No vendor example success. |
| Vendor-enabled focused `review 3` native test | PASS | `native-vendor-guard-final.log`: real admitted TI bytes produce the expected safe diagnostic; 3.256 s, not a switching-output success |
| Two isolated native TI supply decks | vendor abort / ideal-supply control completes | `supply/results.json`; exact final times inspected, not merely process exit status |
| `pnpm test:package` | PASS | `package-final.log`: packed Node/Bun imports and complete in-memory runs, actual settings-free TSX admission, unpatched circuit-json peer, denied-host run, NodeNext declarations |
| `pnpm lint` | PASS | `lint-final.log` |
| `pnpm check:modules` | PASS | `modules-final.log` |
| `pnpm check:vocabulary` | PASS | `vocabulary-final.log`, overall above the unchanged 85% contract |
| `pnpm typecheck` | PASS | `typecheck-final.log`, production and tests |
| Fresh-process five-case/two-attempt exercise | 8 geometry rejections, 2 manually interrupted fields | `cold-attempts.json`; 0/10 native example invocations, no qualified cold timing or native determinism pass |

The last small safety regression, `reference-via plating conductivity is never guessed from mixed
copper materials`, uses an actual TSX material variant and rejects ambiguous barrel conductivity
with `via_geometry`. Its focused run is in `mixed-material.log`.

## Production source size

| `git diff --numstat REF -- src/`, including new files | Added | Removed | Net |
|---|---:|---:|---:|
| Versus `main` | 1,432 | 1,752 | -320 |
| This round versus `4ea0eef` | 171 | 64 | +107 |

No source from the failed speed experiments remains. The net production-source reduction against
main is preserved. The end-to-end goal remains open; the next useful increment needs a converged
nonuniform/oblique connection model plus a field discretization that resolves local singularities
without global dense-panel doubling.
