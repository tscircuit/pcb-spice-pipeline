# Routed stage debugger

Run `pnpm install`, then `pnpm routed:debugger` and open the printed localhost URL.
`pnpm exec vite build examples/routed --outDir ../../.cache/routed-debugger` checks
the browser bundle. The runner and worker use Vite, as solver-utils does.
This branch needs the sibling RFC Circuit JSON/Core/Props builds described in
architecture notes until those packages are released.

Select the two-trace TSX demo and choose your local `sn74lvc1g04.ibs` file. No vendor
bytes are included. Inspect/step through the six stages in GenericSolverDebugger.
Stage 5 awaits one live ngspice WASM transient, then draws actual probe waveforms.
The demo uses 50 Mbps over 40 ns so the vendor transition can settle.
The main thread stays available; status reports engine startup and elapsed wall
time. Every run has a 15 minute watchdog that terminates its worker. Changing
inputs or unmounting the debugger cancels the old worker.

For DDR3, choose the real 1.2 mm eight-layer physical board JSON and local
`sprm552c.ibs` and `W631GG6MB-12.ibs`. The loader renders 24 addr/cmd declarations
from TSX and preserves physical records. Files remain in the browser. Full DDR3
WASM transients are unverified and may need 11–15 minutes. No full DDR transient
is run by the tests.

For headless execution, inject `createNativeSolver({ timeoutMs: 10_000 })` from
`@tscircuit/signal-integrity-pipeline/node` and await `solver.solveAsync()`.
Native processes are serialized across adapter instances and use OMP_NUM_THREADS=1.
Stage 5 has no recording/replay input or successful not-run state. Completion is
candidate evidence without independent convergence qualification.

The browser adapter is exported from `@tscircuit/signal-integrity-pipeline/browser`.
It uses npm `eecircuit-engine@1.9.0` (ngspice 45.2), the published engine tested by
the spike. The worker must be bundled by a tool supporting `new Worker(new URL(...,
import.meta.url))`, such as Vite. Async debugger stepping is pinned to solver-utils
PR #62 and must switch to a released version once that PR ships.

Opt into bounded two-trace native/old-deck/WASM comparisons with `SI_NATIVE_TESTS=1`
and `IBIS_MODEL_DIR`. Vendor-dependent tests explicitly skip without local files.

To render every stage headlessly, run `bun scripts/render-routed-stages.tsx` with
`IBIS_MODEL_DIR` pointing at local vendor files. Set `SI_STAGE_VISUALS_DIR` for the
uncommitted SVG/PNG output directory and `SI_DDR3_BOARD` for the real DDR3 board
JSON. Without that board the script explicitly reports DDR3 as unavailable. Add
`--native-two-trace` for one serial, ten-second-bounded 40 ns / 50 Mbps ngspice run and a second
transient image using actual results; otherwise the script stops before stage 5
and draws a pending panel. DDR3 transient execution is never enabled by this flag.
`manifest.json` records render paths, display object counts and exact deck hashes.

Visual regression tests use the actual two-trace TSX with original synthetic IBIS
tables for drawing only, so they need no vendor assets. SVG text snapshots include
fills, geometry and visible labels with object labels disabled. After inspecting
the PNGs, regenerate these snapshots with `UPDATE_ROUTED_VISUALS=1 bun test`
followed by the stage test filenames. The pure `routeWaveformDrawing` export takes
only a capture, duration and optional error, so the live transient solver can reuse
it directly. The visual fixture uses synthetic engine responses explicitly for
drawing tests, separate from the real native/WASM comparison.

If a real board reaches an existing compiler admission limit, the render script
keeps the completed stages, renders the rejected stage with its reason, and emits
an explicitly upstream-blocked capture drawing. That last image uses the pure
waveform function; it does not imply that the capture solver or ngspice ran. Local
state JSON files contain source inputs and must remain uncommitted with the PNGs.
