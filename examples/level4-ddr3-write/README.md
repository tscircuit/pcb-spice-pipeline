## Routed 2.5D execution

The routed path supports these package matrices and applies the documented vendor C-magnitude interpretation
without changing vendor bytes. Both required files and their hashes are recorded in
`../vendor-models.lock.json`.

Run `IBIS_MODEL_DIR=models bun scripts/run-routed-ddr3.tsx` to run this original
lower-byte TSX through all six `RoutedPipelineSolver` stages. Add `--addr-cmd` for
the 24-net full-board scope; this loads ignored `models/ddr3-board.json` or the
`SI_DDR3_BOARD` override. See the root README for the local board's source path.
`SI_STAGE_VISUALS_DIR` sets the local output directory (default `.cache/ddr-level4`).
The runner permits one ngspice invocation, sets a 45-minute native deadline through
the adapter, and saves stage-6 PNG/SVG, capture, model evidence and timing/peak Node
RSS. Native execution is serialized with `OMP_NUM_THREADS=1`. Results remain
candidate-unqualified; completion alone establishes no electromagnetic accuracy or
JEDEC timing compliance.


## Current measured boundary

The addr/cmd scope passes stages 1–5: 1,835 cells, 18,174,154 deck bytes and
36,814 mutual-inductor terms including packages. Sparse assembly preserves the
original coefficients and text; it removes dense storage/scans, not physical
coupling. Fields took 87.6 s (10,639 cache hits) and network assembly 42.1 s.

The single native 8 ns attempt used OMP_NUM_THREADS=1 and a 45-minute deadline.
It aborted after 1,133.9 s at 1.93269 fs with `Timestep too small`, identifying
`varcs11707#branch` in the coupled Foster skin-loss network. Only nine internal
rows were reported. No completed DDR waveform exists from this attempt, so its
switching, 1.5 V levels and flat-line/NaN sanity remain unverified. This is an
open native convergence blocker, not an end-to-end success.

The original lower-byte TSX separately passes compilation (86 cells, 8,423,175
bytes); it has no native capture.
