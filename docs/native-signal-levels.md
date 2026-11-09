# Native signal API evidence

The runner renders the actual TSX examples through the temporary adapter for unpublished core#5286 and calls public `runPipeline` with real TI IBIS bytes and `/opt/homebrew/bin/{fasthenry,FasterCap,ngspice}`. Vendor files and complete native decks remain local and ignored. Committed summaries under `tests/evidence/signal-levels` distinguish accepted results from failed or interrupted solves.

## Ideal die rails

Under `pdn="ideal"`, IBIS die-side POWER/GND references connect directly to the ideal rails, with no package R/L/C on POWER/GND pins. Vendor signal-pin package R/L/C remains enabled as a pi network with split shunt capacitance. `pdn="extracted"` remains explicitly unimplemented.

Non-power-aware IBIS models assume ideal die rail voltages. These models lack `[Composite Current]`, ISSO and split C_comp power-aware data; on-die decoupling is not described. Feeding their die rails through bare package inductance is therefore unphysical. The user-approved interpretation follows the RFC's `pdn="ideal"` promise of perfect rails; it supersedes the earlier implementation's inclusion of scalar POWER/GND package leads.

KU/KD coefficients are computed by `switchingWeights` in the pinned `@tscircuit/ibis-to-spice` tarball `ad1ec9e640a92a4d370fc76acbbd8db245563317`, then scheduled by its `bitWeights`. This repo only inserts package networks. The inverter's generated KU range is −0.0657680079208…1.00741880404 and KD is −0.172649925905…1.00324434607. No coefficient is clipped or otherwise modified. The separate upstream investigation owns any coefficient correction.

## Fresh native verification

The ideal-rail implementation is committed at `37f2392263453b59dcdca63842638cd26b6c7f0d`. Each native process has a 180 s limit. Only exact-request-hash native extraction outputs may be replayed; every idle and switching transient is fresh ngspice execution. The three Level 3 blocks are isolated from the full rendered board while retaining its planned seeds and copper. Concurrent runs and local tests make elapsed times unsuitable as performance comparisons.

Extraction uses native FastHenry R/L and FasterCap Maxwell C with mesh, reciprocity, passivity, DC resistance and neutral-charge/energy checks. A 3D copper model is built first. Only verified straight parallel signals over a rectangular return contacted at opposite ends may use the extra 2D bar reduction.

Transient convergence independently halves timestep and doubles sections. Every probe must pass both time-integrated RMS and signed-peak tolerances (1% + 1 mV), comparing every timestamp in both adaptive native traces. First-order Gear and IBIS tolerances are unchanged. Quiet peaks retain both signs and use an independent settled constant-drive idle solve; disabled victims also require alternate-initial-charge checks. Numerical settings alone do not establish physical validity.

All five cases converge at four sections in `ideal-die-rails.json`. The table gives the largest peak change over all probes; every probe also passes its RMS check. The full per-probe values, native requests, extraction-replay provenance, model/schema/converter hashes and accepted results are committed in that file. Raw requests and losslessly archived native outputs remain under `runs/ideal-die-rails*`.

| Case | Total elapsed (s) | Timestep peak delta (mV) | Section peak delta (mV) | Result |
| --- | ---: | ---: | ---: | --- |
| Single | 89.948 | 0.186977 | 2.776489 | Converged |
| Differential | 253.166 | 0.000164 | 0.000079 | Converged |
| TRAFFIC | 434.928 | 0.116683 | 3.606621 | Converged |
| QUIET_LOW | 395.066 | 0.061188 | 2.044217 | Converged |
| QUIET_HIGH | 378.160 | 0.072410 | 1.502090 | Converged |

The final maximum timestep is 14.576129 ps for single/three and 14.807340 ns for differential. Every recording completes: 2.4 us for single/three, 192 us for differential, with measurement gates of 0.8 us and 64 us respectively.

| Eye | Height (V) | Width (ns) | Mask margin (V) |
| --- | ---: | ---: | ---: |
| Single DATA | 3.299981 | 49.740514 | 0.799981 |
| Differential BUS | 4.466424 | 3932.799340 | 2.033210 |
| TRAFFIC D0 | 3.286102 | 47.644185 | 0.793135 |
| TRAFFIC D1 | 3.281172 | 47.600220 | 0.791891 |
| TRAFFIC D2 | 3.284261 | 47.573996 | 0.791673 |
| QUIET_LOW D0 | 3.286793 | 49.543261 | 0.793383 |
| QUIET_LOW D2 | 3.293363 | 49.544985 | 0.799981 |
| QUIET_HIGH D0 | 3.285862 | 49.542713 | 0.793025 |
| QUIET_HIGH D2 | 3.292833 | 49.544349 | 0.799981 |

Quiet D1 has no eye. Its signed noise is measured relative to the separate idle solve:

| Block | End | Idle (V) | Positive peak (V) | Negative peak (V) |
| --- | --- | ---: | ---: | ---: |
| QUIET_LOW | NEXT | 0.001657 | +0.145222 | −0.159380 |
| QUIET_LOW | FEXT | 0.001657 | +1.290258 | −0.864660 |
| QUIET_HIGH | NEXT | 3.299742 | +0.128930 | −0.145032 |
| QUIET_HIGH | FEXT | 3.299742 | +1.322569 | −1.174905 |

The large crosstalk excursions remain in the accepted model results. The single-ended receiver also retains overshoot/undershoot (approximately −0.694…4.109 V after settling). Convergence does not establish the accuracy of the upstream coefficient reconstruction or assign these residual excursions to it. KU/KD remains outside [0,1] and unchanged. No further Level 3 divergence investigation was needed because every probe passed both refinements.

Reproduce the actual TSX runs (omit `SI_EXTRACTION_CACHE` for fresh extraction):

```sh
IBIS_MODEL_DIR=models SI_NATIVE_TIMEOUT_MS=180000 SI_RUN_ROOT=runs/ideal-die-rails node --import tsx scripts/run-signal-levels.tsx single
IBIS_MODEL_DIR=models SI_NATIVE_TIMEOUT_MS=180000 SI_RUN_ROOT=runs/ideal-die-rails node --import tsx scripts/run-signal-levels.tsx differential
IBIS_MODEL_DIR=models SI_NATIVE_TIMEOUT_MS=180000 SI_BLOCK=TRAFFIC SI_RUN_ROOT=runs/ideal-die-rails-TRAFFIC node --import tsx scripts/run-signal-levels.tsx three
IBIS_MODEL_DIR=models SI_NATIVE_TIMEOUT_MS=180000 SI_BLOCK=QUIET_LOW SI_RUN_ROOT=runs/ideal-die-rails-QUIET_LOW node --import tsx scripts/run-signal-levels.tsx three
IBIS_MODEL_DIR=models SI_NATIVE_TIMEOUT_MS=180000 SI_BLOCK=QUIET_HIGH SI_RUN_ROOT=runs/ideal-die-rails-QUIET_HIGH node --import tsx scripts/run-signal-levels.tsx three
```

## Historical bounded investigation

`section-investigation.json` and `section-native.json` retain the earlier diagnoses and failures at their actual runner heads. They predate the ideal-rail fix. The old RMS-only snapshots were withdrawn because they could miss narrow NEXT/FEXT peaks and used a waveform-mean baseline.

At base `1a20782`, typical-corner 10–90% vendor edges and modal delays required 2 single-ended / 1 differential / 2 three-signal sections for these 10 mm routes. The existing two-section start already met that edge criterion. No channel R/L/C scaling, stitch, Maxwell-sign or half-shunt defect was demonstrated. An independent native 100 ps / 50 ohm line regression checks delay, impedance, section/stage invariance and nonzero reference wiring.

The 4-vs-8 first-edge comparison found the first difference above 10 mV at driver die power around 352.5635 ns, before driver board (352.5639 ns) and receiver board (352.6309 ns). Four-section die power spanned −39.7727…45.7685 V; receiver signed-peak delta was 3.71990 V. The bounded ideal-die-rail diagnostic reduced it to 0.9003 mV, motivating the adopted ideal-PDN semantics. Coefficient clipping reduced it to 13.625 mV but remains diagnostic only. Second-order Gear and LTRA/CPL prototypes did not establish convergence and were not adopted.

The obsolete investigation harness was removed after adding the focused TSX/native regression. Its original commands and source remain available at commit `13a97ca1a7bf5cac4d0e5fede31a4e6cd5456439`; no new diagnostic package or distributed-line path remains in production.

Earlier complete single-ended recordings did not converge spatially; the 32-section solve hit a 600 s process bound. Its 16-section candidate eye (3.298106 V × 45.185682 ns) is historical and unaccepted. All earlier Level 3 attempts stopped before their 0.8 us gate, so their NEXT/FEXT and eyes are unavailable, not zero. The earlier differential result (4.464708 V × 3.932765 us) passed both criteria. These old measurements have not been relabeled as fresh-head results.

## Local checks and boundaries

`IBIS_MODEL_DIR=models NGSPICE_BIN=/opt/homebrew/bin/ngspice npm test` passes 225 of 227 tests with two optional skips and no failures. The new TSX/vendor regression covers all three package corners and unchanged upstream KU/KD. The native vendor-buffer regression compares 4/8 sections over the problematic first edge using fixed native-extracted channel totals; it does not rerun extraction. The full native runner independently checks complete fixture recordings.

Typecheck, lint, module and vocabulary checks pass. Lint retains the existing 521-line mesh warning. The focused API/documentation checks also pass after updating the ideal-rail terminology and diagrams.

Local checks use the existing built sibling-schema overlay; no local links or vendor bytes are committed. CI's published circuit-json dependency still lacks the SI exports. The actual RFC DDR3 asset is `examples/levels/level4-ddr3-write.tsx`; it stops at `.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.` before native solver IO. This is a documented boundary, not DDR validation.

Extracted PDN, coupled package matrices and branched routed graphs retain explicit not-implemented errors. Finite simulated eyes do not establish BER, hardware accuracy or protocol compliance. Analytic waveforms and canned matrix tests are synthetic checks, not native fixture evidence.
