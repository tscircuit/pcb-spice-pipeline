# Signal-integrity API levels

These six TSX files are byte-identical copies of the RFC assets at `5f4d848f91aab44b7426480e98792a99d5493bea`, including `parts.tsx`. They use real footprints, autorouting, and the RFC's opposite-layer GND-pour declarations. No fixture-only pads, ground strips, or TypeScript suppressions are included here.

- `level1-single-ended.tsx`: one TI inverter channel.
- `level1-differential.tsx`: one TI SN65HVD72 pair with a 120 ohm termination.
- `level2-two-signals.tsx`: two switching signals.
- `level3-three-signals.tsx`: TRAFFIC, XTALK_LOW, and XTALK_HIGH blocks.
- `level4-ddr3-write.tsx`: the AM335x/Winbond write illustration; coupled packages remain unimplemented.

Current real-core runs do not yield accepted full-plane results: the GND pours need escape-routing intent, differential autorouting fails, and the DDR3 numeric trace key fails the supplied props typecheck. The source files are intentionally unchanged; exact suggested upstream edits and all measurement limits are in `docs/native-signal-levels.md`. Earlier strip-fixture results are superseded.

Use local vendor files and built sibling dependencies as documented there. Vendor bytes and local dependency overlays are never committed.
