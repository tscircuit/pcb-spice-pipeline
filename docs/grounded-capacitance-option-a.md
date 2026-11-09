# Ground-referenced capacitance experiment A

**WORKS under Option A’s grounded-reference convention:** all three requested boards pass extraction and independent timestep/section convergence without changing numerical criteria or averaging C. This changes the RFC’s floating-reference physics; it is not validation of that original convention or of hardware accuracy.

Local branch `wip/si-cap-a`, starting at `1eacbdd` of tscircuit/signal-integrity-pipeline PR #62. This is an experimental change to the RFC's physical reference convention. No RFC file, solver setting, tolerance, board source, vendor model, dependency overlay, other worktree or other repository was edited. Nothing was pushed and no PR was opened. Level 3 is out of scope.

Machine-readable results: [grounded-capacitance-option-a.json](../tests/evidence/signal-levels/grounded-capacitance-option-a.json). Ignored `runs/option-a/` retains native requests, replay provenance, logs and losslessly archived waveforms; vendor model bytes and symlinks are not committed. The old [native evidence](native-signal-levels.md) describes the baseline convention.

**Implementation.** The final primitive conductor already joins the ground pour, ground leads and GND vias. Hold it at zero relative to infinity, select `Cprim[signals,signals]`, and apply the original 0.025 reciprocity threshold to that block. Preserve every raw signal coefficient. The full primitive residual remains a diagnostic and is explicitly marked unchecked. Grounded signal-charge/energy reconstruction replaces the neutral-charge invariant; total charge is diagnostic, not forced to zero. R/L loop reduction, native meshing, FasterCap auto convergence and all transient criteria are unchanged. The C block uses the prescribed 2.5% physical reciprocity criterion; the existing internal 1e-10 R/L serialization guard remains unchanged, and a native AC test verifies raw C serialization to relative 1e-10.

The previous generic validation averaged accepted matrices and the passive-capacitor SPICE writer required essentially exact symmetry. For raw C, positive row and column sums plus Maxwell signs establish positive quadratic energy without changing coefficients. If a retained C block is unequal to its transpose, zero-volt current sensors and controlled current sources implement `I_i = sum_j C_ij dV_j/dt`, including both distinct mutual coefficients. Exactly symmetric C retains the original capacitor topology. A native AC test excites both independent columns of the actual coupled TSX fixture with a 1.7 V reference offset and reconstructs every coefficient to relative 1e-10. This is numerical matrix preservation, not a claim of exact reciprocity or exact passivity for a nonsymmetric capacitive network.

**Hypothesis.** Residual means `max(abs(C-C^T))/max(abs(C))`, with its own denominator for each block. The one-signal block is 1×1, so its zero reciprocity residual is tautological and cannot independently validate its diagonal. All large mismatches pair a signal with ground; signal-to-signal residuals are much smaller. This supports discarding plane excitations for the proposed grounded model. It does not prove which direction is wrong: both members of a mismatched pair are numerical outputs, and no independently accurate ground-charge solution was obtained.

| Case | Full residual | Signal-block residual | Acceptance limit |
| --- | ---: | ---: | ---: |
| Minimal single | 13.3505% | 0% | 2.5% |
| Minimal coupled | 9.8513% | 0.04884% | 2.5% |
| Level 1 single-ended | 10.7039% | 0% | 2.5% |
| Level 1 differential | 9.4996% | 0.03270% | 2.5% |
| Level 2 | 9.6753% | 0.01556% | 2.5% |

| Case | Signal-return transpose mismatch, pF | Signal-signal transpose mismatch, pF |
| --- | --- | ---: |
| Minimal single | 0.384240 | n/a |
| Minimal coupled | 0.338385, 0.340153 | 0.000803 |
| Level 1 single-ended | 0.280711 | n/a |
| Level 1 differential | 0.395560, 0.426640 | 0.000900 |
| Level 2 | 0.309713, 0.317824 | 0.000165 |

For example, the minimal single trace has `Csignal,ground=-1.06686 pF` versus `Cground,signal=-1.45110 pF`; Option A uses only its unchanged `Css=1.52120 pF`. The coupled fixture retains `[[1.64322,-0.456784],[-0.455981,1.64424]] pF` exactly. Fresh native requests match the baseline fixture hashes, so the change is in interpretation/acceptance, not solver tuning.

**Analytic comparison.** Both fixtures use real core's 40 mm × 0.15 mm traces, 1.43 mm FR-4, er=4.42 and 0.03 mm copper. The coupled pitch is 0.75 mm (0.60 mm edge gap). The independent calculation uses the published [single-line](https://qucs.sourceforge.net/tech/node75.html) and [coupled-line](https://qucs.sourceforge.net/tech/node77.html) Hammerstad/Jensen equations; `u=0.104895`, `g=0.419580` are within the stated coupled-model range. The collector evaluates homogeneous mode impedances, divides by `sqrt(effective epsilon)`, then obtains `Ce,o=sqrt(epsilon_e,o)/(c Ze,o)` and `Cmutual=(Co-Ce)/2`. No native coefficient is used to fit the estimate.

| Quantity | Native Option A, pF/m | Published-model estimate, pF/m | Difference |
| --- | ---: | ---: | ---: |
| Single C′ | 38.0300 | 37.56593 | +1.235% |
| Coupled diagonal 0 / 1 | 41.0805 / 41.1060 | 40.44112 | +1.581% / +1.644% |
| Coupled mutual, both directions | 11.4196 / 11.399525 | 10.73888 | +6.339% / +6.152% |

Estimated even/odd mode values are 29.70224 / 51.18000 pF/m, 196.37096 / 107.63560 Ω, and effective er=3.05756 / 2.72743. The estimate is zero thickness with infinite ground and uniform infinite cross section; the finite native fixture includes copper thickness, ends and board edges. Those contributions and solver error are not independently separated. The mutual discrepancy is not a few-percent validation, even though reciprocity and auto-refinement pass. Fresh single/coupled FasterCap wall times are 11.696 / 28.194 s; auto residuals are 1.25243% / 0.99034% against 2%.

**Native end-to-end evidence.** Every input JSON hash and all three extraction request hashes match the corresponding baseline. The single-ended case is fully fresh. The differential case replays complete pre-reboot extraction/idle/initial/timestep calls and freshly solves its section refinement. Level 2 replays one completed coarse R/L call, then freshly executes refined R/L, C, idle and all transients. No rejected extraction enters a transient.

| Case | L′ µH/m (diagonals) | C′ pF/m (diagonals) | Eye height V | Eye width ns | Wall time s |
| --- | --- | --- | --- | --- | --- |
| Level 1 single-ended | 0.888551 | 37.958635 | 3.299981 | 48.022048 | 747.645 fresh |
| Level 1 differential | 0.836333, 0.838331 | 47.944379, 47.599504 | 4.454710 | 3932.656925 | 202.807 resumed |
| Level 2 | 0.896230, 0.921573 | 37.702221, 37.507687 | 3.277005, 3.274277 | 47.739510, 47.689527 | 891.017 resumed |

Eye mask margins are 0.799981 V (single), 2.027353 V (differential), and 0.795490 / 0.794902 V (Level 2). These are finite observed eyes with the existing IBIS/package and ideal-rail assumptions. Quiet NEXT/FEXT is **not applicable**: none of these three boards declares a quiet victim. No quiet stimulus or extra scenario was invented.

| Case | R mesh delta | L mesh delta | C auto residual | Extraction |
| --- | ---: | ---: | ---: | --- |
| Level 1 single-ended | 1.339232% | 0.122724% | 1.72399% | accepted |
| Level 1 differential | 0.056262% | 0.167336% | 1.79571% | accepted |
| Level 2 | 1.392211% | 0.156552% | 1.37133% | accepted |

The mesh limits remain 5% R/L, 2% C auto and 2.5% signal-block reciprocity. Grounded energy reconstruction residual is zero for each board. `neutralityResidual` is diagnostic only and is not expected to vanish.

| Case / probe | Time Δ RMS mV | Time Δ signed peak mV | Section Δ RMS mV | Section Δ signed peak mV |
| --- | ---: | ---: | ---: | ---: |
| Level 1 single-ended / 0 | 0.068147341 | 0.033837372 | 1.539440091 | 1.968179703 |
| Level 1 differential / 0 | 0.000120006 | 0.000132005 | 0.000191964 | 0.000112821 |
| Level 2 / 0 | 0.065518011 | 0.043777272 | 1.592618637 | 3.620685519 |
| Level 2 / 1 | 0.069573179 | 0.051013429 | 1.651822913 | 4.772957044 |

All probes pass both dimensions against the original **1% + 1 mV** RMS and both signed-extrema criteria. Final single/Level 2 settings are 8 sections and 14.576129 ps maximum step (from 4 and 29.152259 ps); differential is 4 sections and 14.807340 ns (from 2 and 29.614680 ns). Full-resolution waveform hashes, sample counts, signed extrema and scale voltages are retained in the JSON. The wall times in the first table are actual runner wall times; resumed times include cache loading and remaining native work, not the earlier work they replay.


The first Level 2 attempt stopped in refined FastHenry at the 600 s process limit (702.456 s total), before C. One fresh retry used a 900 s process limit. The Mac then rebooted at 2026-11-09 14:23:11 UTC while that refinement and the differential section check were running. Neither interrupted call produced a solver completion or failure; interruption is recorded separately. After checking unchanged binary hashes, the runs resumed with 900 s process bounds. Only complete byte-identical native requests were replayed, including losslessly archived transient output; the interrupted requests executed again. The differential replay covers its three extraction calls, three idle calls, initial transient and timestep refinement. The Level 2 replay covers only its completed coarse FastHenry call. These are not fresh uncached reruns, and their resumed wall times cannot be compared directly with cold-run times. The interrupted pre-reboot segments lasted approximately 1319.154 s (differential) and 586.457 s (Level 2 retry), measured from each archived input file to the kernel boot time; these approximations are not complete successful case wall times.

**Physics and magnitude.** Grounding is a different boundary condition. It permits a charge reservoir to hold the physical return at the infinity potential. The signal-block diagonal still includes fields and charge to infinity; that contribution is not removed. Mapping all shunt current to the channel REF conflates the infinity sink with the ground terminal. The floating finite-board common voltage and charge-neutral common-mode response are lost. This is appropriate only when that grounded reference approximation is intended; it cannot represent an isolated floating board or establish common-mode/radiation accuracy from loop R/L.

For one 1 V signal excitation with other conductors at zero, the raw native total charge divided by the excited signal charge is 4.61% (minimal single), 2.17–2.32% (minimal coupled), 3.94% (Level 1 single), 1.16–1.71% (differential), and 2.93–3.00% (Level 2). These nonzero totals show what the grounded reservoir/infinity sink absorbs.

A formal charge-neutral elimination on the *unvalidated, nonsymmetric* primitive matrix uses `Css - (C1)s (1^T C)s / (1^T C1)`. Its diagnostic diagonal difference from the grounded block is 1.11% (minimal single), 0.425–0.462% (coupled), 0.661% (Level 1 single), 0.225–0.318% (differential), and 0.519–0.521% (Level 2). These are algebraic magnitudes only, not validated floating capacitances or physical error bounds: the full primitive fails reciprocity. In particular, substituting row sums for column sums on this nonreciprocal matrix gives different answers. No such formal reduction is used in Option A's RLGC or transients.

The small retained signal asymmetry is also a caveat. A physical electrostatic capacitance operator is reciprocal; a nonsymmetric controlled-source realization is not an exactly reciprocal passive capacitor network. Positive quadratic energy and passing the prescribed residual limit do not prove arbitrary-frequency passivity of that realization. No averaging hides this residual.

**RFC text required, not applied.** Replace the entire current C-convention passage (the sentence beginning “C uses a **floating finite return with total charge neutrality**”, its neutral formula, and the following explanatory/example paragraph, lines 748–758 in the supplied RFC) with this exact sentence:

> C uses the grounded physical return at 0 V relative to infinity: with `s` indexing the signal conductors and all GND pours and GND-connected conductors grouped as the reference, `C = Cprim[s,s]`; apply the unchanged 2.5% reciprocity criterion to this signal block, retain its coefficients without averaging, and do not impose total charge neutrality.

The old neutral formula and `10/3, -5/3` example must be removed with that passage; merely changing its first sentence would leave a contradiction. The analogous nonzero-G paragraph would also need a consistent grounded convention before lossy G is implemented; this experiment only has zero G.

**Reproduction and checks.** Export `IBIS_MODEL_DIR=models`, `SI_CORE_MODULE="$PWD/../core/dist/index.js"`, `TSX_TSCONFIG_PATH=examples/tsconfig.json`, and `NGSPICE_BIN=/opt/homebrew/bin/ngspice`. Then:

```sh
SI_RUN_ROOT=runs/option-a/fixtures SI_INTERFACE_REFINEMENT=0 node --import tsx scripts/check-layered-capacitance.tsx
SI_TEST_NATIVE_CAPACITANCE=1 node --import tsx --test tests/extraction/dielectric.test.ts
SI_RUN_ROOT=runs/option-a/levels SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx single
SI_RUN_ROOT=runs/option-a/levels SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx differential
SI_RUN_ROOT=runs/option-a/levels SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx two
SI_RUN_ROOT=runs/option-a/retry SI_NATIVE_TIMEOUT_MS=900000 node --import tsx scripts/run-signal-levels.tsx two
# Optional exact resume after an external interruption; accepts only complete matching requests.
SI_EXTRACTION_CACHE=runs/option-a/levels/differential SI_REPLAY_COMPLETE_NATIVE=1 SI_RUN_ROOT=runs/option-a/resume SI_NATIVE_TIMEOUT_MS=900000 node --import tsx scripts/run-signal-levels.tsx differential
SI_EXTRACTION_CACHE=runs/option-a/retry/two SI_REPLAY_COMPLETE_NATIVE=1 SI_RUN_ROOT=runs/option-a/resume SI_NATIVE_TIMEOUT_MS=900000 node --import tsx scripts/run-signal-levels.tsx two
node --import tsx scripts/collect-grounded-capacitance.mjs
npm test
npm run typecheck
npm run lint
npm run check:modules
npm run check:vocabulary
```

The default suite passes 234/238 with four optional skips, zero failures. All four opt-in native dielectric tests pass. Typecheck, lint, module checks and vocabulary (88.9%, target 85%) pass. Lint retains the existing 523-line mesh warning. These are local overlay checks, not published-dependency CI or hardware validation. Native AC matrix preservation is also tested with `NGSPICE_BIN` enabled.


**Files touched.**

| Area | Files |
| --- | --- |
| Extraction | `src/extraction/checks.ts`, `extract.ts`, `rlgc.ts`, `types.ts` |
| Regressions | `tests/extraction/dielectric.test.ts`, `checks.test.mjs`, `decks.test.mjs`, `extract.test.ts`, `rlgc.test.ts`, `diagnostics.test.ts` |
| Evidence runners | `scripts/check-layered-capacitance.tsx`, `collect-grounded-capacitance.mjs`, `run-signal-levels.tsx` |
| Documentation | `docs/ARCHITECTURE.md`, `native-signal-levels.md`, `grounded-capacitance-option-a.md` |
| Compact results | `tests/evidence/signal-levels/grounded-capacitance-option-a.json` |

`linalg.ts` was inspected but not changed. `node_modules` and `models` remain untracked symlinks. `runs/` stays ignored. The increase in production code is required to retain unequal raw mutual coefficients rather than silently averaging or discarding one direction.

**Local commits.**

| SHA | Change |
| --- | --- |
| `5bba6cb18316d0c97f5029e450ba74a06854d0c7` | Failing TSX-derived signal-block regression |
| `87a3bf4a1e5c55ac7f5480661c6bb5e072eaf002` | Grounded-block extraction and exact raw-C SPICE representation |
| `0109dd8d092d8ab7fa0df37fd4c3a44717716c6a` | Grounded energy diagnostics and evidence collector |
| `59913c82fd413ef631b324a1e059b7bf06bcdfa6` | Exact complete-request resume support after the reboot |

The final evidence/documentation commit is the tip following these commits. No remote branch or PR was created.
