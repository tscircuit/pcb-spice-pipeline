# Native signal API evidence

The prior RMS-only snapshots have been withdrawn: they did not establish convergence of narrow NEXT/FEXT peaks and used a waveform-mean baseline. Fresh evidence is generated from the final RFC implementation, not relabeled from those runs.

The runner renders the real TSX fixtures through the temporary adapter for unpublished core#5286. It calls the public `runPipeline` with real TI IBIS bytes and `/opt/homebrew/bin/{fasthenry,FasterCap,ngspice}`. Vendor files are local, ignored, and never redistributed. `runs/rfc-final/<case>` stores exact requests, input Circuit JSON, native outputs and success/failure summaries. Committed summaries under `tests/evidence/signal-levels` are the compact evidence; an interrupted or failed solve has no accepted eye/NEXT/FEXT result.

Extraction uses native FastHenry R/L and FasterCap Maxwell C, with mesh, reciprocity, passivity, DC resistance and neutral-charge/energy checks. A 3D copper model is built first. Only straight parallel signals and a rectangular return contacted at opposite ends may use the extra 2D bar reduction.

Transient convergence independently halves timestep and doubles sections. Each probe must meet both time-integrated RMS and signed peak tolerances (1% + 1 mV). Comparison uses every timestamp from both adaptive native traces, without a sparse display grid. First-order Gear with ngspice's default truncation setting and tight IBIS tolerances avoid accepting ringing based only on RMS. NEXT/FEXT retain both signs and use a separate constant-drive, settled idle solve; disabled victims also undergo an alternate-initial-charge check.

Status while these runs are refreshed: Level 1 SE, Level 1 differential and Level 3 (traffic, quiet-low, quiet-high) are native candidates until their summaries say `verified_native`. The exact signed results and convergence tables will be recorded after successful completion. No old numerical claim remains valid evidence for this revision.

The actual RFC DDR3 TSX asset is in `examples/levels/level4-ddr3-write.tsx`. `IBIS_MODEL_DIR=models node --import tsx scripts/check-ddr3.tsx` rendered it using real AM335x/Winbond files and stopped with `.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.` before any native call. This is the RFC's documented boundary, not DDR compliance validation.

Extracted PDN, coupled package matrices and branched routed graphs have the RFC's explicit not-implemented errors. Finite transient eyes do not establish BER, hardware accuracy or protocol compliance. Unit tests with analytic waveforms or canned matrix outputs are synthetic checks, not native evidence.
