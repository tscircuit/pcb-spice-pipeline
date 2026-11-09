# Native signal API evidence

The prior RMS-only snapshots have been withdrawn: they did not establish convergence of narrow NEXT/FEXT peaks and used a waveform-mean baseline. Fresh evidence is generated from the final RFC implementation, not relabeled from those runs.

The runner renders the real TSX fixtures through the temporary adapter for unpublished core#5286. It calls the public `runPipeline` with real TI IBIS bytes and `/opt/homebrew/bin/{fasthenry,FasterCap,ngspice}`. Vendor files are local, ignored, and never redistributed. `runs/rfc-final/<case>` stores exact requests, input Circuit JSON, native outputs and success/failure summaries. Committed summaries under `tests/evidence/signal-levels` are the compact evidence; an interrupted or failed solve has no accepted eye/NEXT/FEXT result.

Extraction uses native FastHenry R/L and FasterCap Maxwell C, with mesh, reciprocity, passivity, DC resistance and neutral-charge/energy checks. A 3D copper model is built first. Only straight parallel signals and a rectangular return contacted at opposite ends may use the extra 2D bar reduction.

Transient convergence independently halves timestep and doubles sections. Each probe must meet both time-integrated RMS and signed peak tolerances (1% + 1 mV). Comparison uses every timestamp from both adaptive native traces, without a sparse display grid. The current deck forces first-order Gear and tight IBIS tolerances; neither numerical setting establishes physical validity on its own. NEXT/FEXT retain both signs and use a separate constant-drive, settled idle solve; disabled victims also undergo an alternate-initial-charge check.

The final-RFC differential run at `a5e85f3` completed in 329.910 s (see the committed summary for the exact time). Eye height is 4.464708 V, width 3.932765 µs, mask margin 2.032352 V. The timestep check at 2 sections had 2.30 nV peak change; the independent section check at 4 sections had 1.79 µV peak change. Both passed the per-probe RMS and peak criteria. This case has no quiet victim, so no NEXT/FEXT record is applicable.

Level 1 SE did not converge spatially. The last complete 16-section trace has an independently calculated candidate eye height of 3.298106 V, width 45.185682 ns and margin 0.798106 V; these are **unconverged**, not accepted result records. Its output ranges from −2.667553 V to 6.995626 V after settling. The 32-section solve exceeded the 600 s native-process limit near 2.29547 µs of 2.4 µs. The whole attempt took 3581.672 s. `single-unconverged.json` records every completed check and exact request digests.

| SE refinement | Sections | Maximum step (ps) | RMS change (V) | Signed peak change (V) | Accepted check |
| --- | ---: | ---: | ---: | ---: | --- |
| Time | 2 | 14.576129 | 0.000062814 | 0.000397360 | Yes |
| Space | 4 | 14.576129 | 0.116311341 | 0.050512530 | No |
| Time | 4 | 7.288065 | 0.000052853 | 0.000128915 | Yes |
| Space | 8 | 7.288065 | 0.255166969 | 3.485882777 | No |
| Time | 8 | 3.644032 | 0.000249018 | 0.000087576 | Yes |
| Space | 16 | 3.644032 | 0.241300819 | 2.045053266 | No |
| Time | 16 | 1.822016 | 0.000209904 | 0.001769507 | Yes |

All three Level 3 blocks were attempted natively. TRAFFIC failed with `native_timeout` after 1043.880 s including extraction, at a last reported transient time of 0.655883 µs. QUIET_LOW returned `native_solver` after 601.781 s at 0.676601 µs; QUIET_HIGH returned `native_timeout` after 601.760 s at 0.729304 µs. Each stopped before the 0.8 µs settling gate, so **signed NEXT/FEXT and Level 3 eyes are unavailable**, not zero. The isolated quiet-block attempts preserved the full board's planned seeds and copper; only exact-request native extraction outputs were replayed. Their committed `three-*-failed.json` files identify that replay and every native ngspice request.

The native evidence records its actual implementation head (`a5e85f3` for SE, differential and TRAFFIC; `ad46600` for isolated quiet blocks). Subsequent changes strengthen idle completion/charge checks, routing admission, artifact retention and evidence storage; the failed attempts have not been relabeled as final-head successes. No old RMS-only numerical claim remains valid evidence. Resolving the native stiffness/spatial nonconvergence remains necessary before calling these fixtures verified.

## Bounded section investigation (2026-11-09)

`section-investigation.json` records commands, native deck/log hashes and numbers at base head `1a20782`. Production netlists and convergence criteria are unchanged. The reproducible harness is `scripts/investigate-signal-sections.mjs`; it reads decks generated from the existing actual TSX examples by `scripts/run-signal-levels.tsx`. Complete decks and vendor bytes remain ignored. These are bounded diagnostics, not a successful single-ended or Level 3 fix.

Hypothesis 1 was insufficient edge resolution. Typical-corner 10–90% edges are interpolated from each selected vendor waveform, taking the fastest rising/falling fixture. The inverter rises in 0.670–0.934 ns and falls in 0.583–0.925 ns; the fastest RS485 leg edge is 592.294 ns. For coupled lines, `sqrt(eigenvalues(L*C))` gives modal delays from the total extracted matrices. Thus `v = length/delay` and `N = ceil(10*delay/edge)` implement `section_length <= v*edge/10` without a per-metre/total conversion error.

| Fixture (all 10 mm) | Fastest edge | Modal delay | Modal velocity (m/s) | Maximum section length | Required sections |
| --- | ---: | ---: | ---: | ---: | ---: |
| Single | 0.583045 ns | 70.6841 ps | 1.41475e8 | 8.24861 mm | 2 |
| Differential | 592.294 ns | 72.7322–74.2367 ps | 1.34704e8–1.37491e8 | 7.97845–8.14349 m | 1 |
| Three | 0.583045 ns | 69.9822–70.9229 ps | 1.40998e8–1.42894e8 | 8.22083–8.33134 mm | 2 |

The implementation already starts at two sections. Single-ended N=2 and N=4 each exhausted a 120 s bound at 2.15406 and 1.90676 us, respectively; neither produced a complete new waveform. The earlier complete 2-vs-4 comparison still rejects convergence (RMS 0.116311341 V, peak delta 0.050512530 V). Increasing the count beyond the edge requirement is not justified as a demonstrated fix.

Hypothesis 2 was a bad stitch or half-shunt. A 4-vs-8 comparison records driver board/die/ground/power, quarter/half/three-quarter line, receiver board/die/ground over 349–360 ns. Both native solves finished (7.982 / 14.100 s). The first difference above 10 mV occurs at driver power around 352.5635 ns, then driver board at 352.5639 ns, and receiver board at 352.6309 ns. The 4-section die power rail spans −39.7727 to +45.7685 V; the receiver peak delta is 3.71990 V. This points to active-buffer/package behavior, without proving its root cause. R/L/C scaling, loop/Maxwell signs, shunt halves and terminal references were inspected; no defect in `channelSpice` was demonstrated.

A native regression independently checks a 100 ps, 50 ohm line at 1 GHz: 8/16 sections and two half-stages with four sections each agree with analytic delay and input impedance within 0.1%, and complex voltage within 0.5 mV. A driven 1.7 V reference checks reference-node wiring. R=1 nOhm is the lossless limit because the current validator requires positive-definite R. Run `NGSPICE_BIN=/opt/homebrew/bin/ngspice node --import tsx --test tests/extraction/rlgc.test.ts` (4 passed). This is an analytic native guard, not vendor-device validation.

Two bounded A/B diagnostics isolate the package interaction. Generated KU/KD coefficients reach −0.065768 / −0.172650. Clipping coefficients to [0,1] reduces the first-edge receiver section delta to 13.625 mV; replacing die supply/ground leads with ideal rails reduces it to 0.9003 mV. Both alter required IBIS/package physics, and neither is adopted. Default second-order Gear completed N=2 in 85.187 s, but N=4/8 hit 90 s bounds, so that change is also unverified and not adopted.

Hypothesis 3 was that distributed lines avoid the problem. The bounded prototype uses the same total RLGC with length=1, lossless G=0, LTRA for single-ended and full upper-triangular R/L/C for CPL. The [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf) describes these devices; current [CPL source](https://github.com/ngspice/ngspice/blob/master/src/spicelib/devices/cpl/cplsetup.c) consumes full triangular R despite the manual's diagonal-R guidance. Each prototype hit 90 s: single stopped near 0.352575 us, differential 0.164198 us, three 0.0109077 us. All are before their measurement gates (0.8 / 64 / 0.8 us). No comparison against a converged single-ended ladder or complete differential distributed waveform exists. The ladder stays in production; there is no evidence supporting adoption.

Reproduce the diagnostics after generating `runs/rfc-final/{single,differential,three}` with the native runner:

```sh
node --import tsx scripts/investigate-signal-sections.mjs edge
SI_NATIVE_TIMEOUT_MS=120000 node --import tsx scripts/investigate-signal-sections.mjs ladder
SI_NATIVE_TIMEOUT_MS=30000 node --import tsx scripts/investigate-signal-sections.mjs nodes
SI_NATIVE_TIMEOUT_MS=45000 node --import tsx scripts/investigate-signal-sections.mjs package
SI_NATIVE_TIMEOUT_MS=90000 node --import tsx scripts/investigate-signal-sections.mjs gear
SI_NATIVE_TIMEOUT_MS=90000 node --import tsx scripts/investigate-signal-sections.mjs distributed
```

Do not relabel the package diagnostics, partial traces, or old unconverged eye as accepted results. The bounded attempt did not find a defensible production fix; IBIS/package rail behavior remains the next concrete investigation.

## Final bounded native rerun

`section-native.json` records each command, actual runner head, model/schema hashes, exact native extraction replays, fresh transient requests and signed-peak convergence data. The production netlist is unchanged. No replayed transient is used. The shorter limits intentionally bound this follow-up; they do not supersede the earlier 600 s failures or imply a runtime improvement.

| Case | Per-process limit | Total elapsed | Result | Last reported transient time |
| --- | ---: | ---: | --- | ---: |
| Single | 120 s | 120.978 s | Timeout; no accepted result | 1.90971 us of 2.4 us |
| Differential | 180 s | 232.781 s | Converged | Complete 192 us |
| TRAFFIC | 60 s | 69.309 s | Timeout before gate | 0.153182 us |
| QUIET_LOW | 60 s | 70.139 s | Timeout before gate | 0.131845 us |
| QUIET_HIGH | 60 s | 66.184 s | Timeout before gate | 0.252573 us |

The fresh differential eye is 4.464708256 V × 3.932764896 us, margin 2.032351933 V. Timestep and section peak deltas are 2.30168 nV and 1.78676 uV. Single-ended has no completed new eye or section comparison. Level 3 has no completed measurement after its 0.8 us gate; signed NEXT/FEXT remains unavailable. These failures are not zero-noise measurements.

Local verification: `IBIS_MODEL_DIR=models NGSPICE_BIN=/opt/homebrew/bin/ngspice npm test` passed 223 of 225 tests, with two optional tests skipped and no failures. Typecheck, lint, module and vocabulary checks pass; lint retains the existing 521-line mesh warning. Local checks use the existing unpublished sibling-schema overlay. CI remains blocked on the published circuit-json package lacking the SI exports. The investigation/regression is published; the single-ended/Level 3 physics issue remains unresolved.

The actual RFC DDR3 TSX asset is in `examples/levels/level4-ddr3-write.tsx`. `IBIS_MODEL_DIR=models node --import tsx scripts/check-ddr3.tsx` rendered it using real AM335x/Winbond files and stopped with `.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.` before any native call. This is the RFC's documented boundary, not DDR compliance validation.

Extracted PDN, coupled package matrices and branched routed graphs have the RFC's explicit not-implemented errors. Finite transient eyes do not establish BER, hardware accuracy or protocol compliance. Unit tests with analytic waveforms or canned matrix outputs are synthetic checks, not native evidence.
