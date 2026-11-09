# Native signal API evidence

The prior RMS-only snapshots have been withdrawn: they did not establish convergence of narrow NEXT/FEXT peaks and used a waveform-mean baseline. Fresh evidence is generated from the final RFC implementation, not relabeled from those runs.

The runner renders the real TSX fixtures through the temporary adapter for unpublished core#5286. It calls the public `runPipeline` with real TI IBIS bytes and `/opt/homebrew/bin/{fasthenry,FasterCap,ngspice}`. Vendor files are local, ignored, and never redistributed. `runs/rfc-final/<case>` stores exact requests, input Circuit JSON, native outputs and success/failure summaries. Committed summaries under `tests/evidence/signal-levels` are the compact evidence; an interrupted or failed solve has no accepted eye/NEXT/FEXT result.

Extraction uses native FastHenry R/L and FasterCap Maxwell C, with mesh, reciprocity, passivity, DC resistance and neutral-charge/energy checks. A 3D copper model is built first. Only straight parallel signals and a rectangular return contacted at opposite ends may use the extra 2D bar reduction.

Transient convergence independently halves timestep and doubles sections. Each probe must meet both time-integrated RMS and signed peak tolerances (1% + 1 mV). Comparison uses every timestamp from both adaptive native traces, without a sparse display grid. First-order Gear with ngspice's default truncation setting and tight IBIS tolerances avoid accepting ringing based only on RMS. NEXT/FEXT retain both signs and use a separate constant-drive, settled idle solve; disabled victims also undergo an alternate-initial-charge check.

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

The actual RFC DDR3 TSX asset is in `examples/levels/level4-ddr3-write.tsx`. `IBIS_MODEL_DIR=models node --import tsx scripts/check-ddr3.tsx` rendered it using real AM335x/Winbond files and stopped with `.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.` before any native call. This is the RFC's documented boundary, not DDR compliance validation.

Extracted PDN, coupled package matrices and branched routed graphs have the RFC's explicit not-implemented errors. Finite transient eyes do not establish BER, hardware accuracy or protocol compliance. Unit tests with analytic waveforms or canned matrix outputs are synthetic checks, not native evidence.
