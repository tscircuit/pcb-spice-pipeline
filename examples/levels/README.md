# Signal-integrity API levels

- `level1-single-ended.tsx`: one real TI SN74LVC1G04 output/input channel.
- `level1-differential.tsx`: one real TI SN65HVD72 pair and a normal 120 ohm resistor.
- `level2-two-signals.tsx`: two coupled single-ended signals.
- `level3-three-signals.tsx`: traffic, quiet-low and quiet-high as three blocks.
- `level4-strobe.tsx`: received-strobe timing mechanics with CMOS pad models;
  it is not a characterized DDR memory interface.

The pad fixtures and coplanar return were designed for native API tests. They use
actual routed coordinates and explicit ideal PDN. No simulation.config.ts is needed.
Use the vendor source lock in the parent folder; keep fetched IBIS files local.
The temporary renderer adapter is required until the sibling core/props PRs publish.
See `docs/native-signal-levels.md` for measured results and outstanding limitations.
