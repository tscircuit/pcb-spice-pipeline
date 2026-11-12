# Routed stage debugger

Run `bun install && bun dev` with ngspice on PATH. Open the printed Cosmos URL
and choose a fixture from the sidebar. Set `IBIS_MODEL_DIR` (default `models`)
and `SI_DDR3_BOARD` for local assets, or upload IBIS files on the fixture.
Missing files show their paths. Stage 5 always uses the local HTTP backend.

The two-trace and DDR3 TSX boards are inputs to `RoutedPipelineSolver`.
Stage 5 awaits a live local ngspice transient and draws actual probe waveforms.
The demo uses 50 Mbps over 40 ns so the vendor transition can settle. The old
400 Mbps / 4 ns window ended before the vendor waveform lead-in: its logical edge
was at 2.5 ns, but the DATA receiver first crossed 1.65 V at about 5.625 ns in a
single-edge diagnostic. Driver power and probe mapping were correct. The scheduler
preserves measured IBIS lead-in; it does not force the analog output to switch at
the logical bit boundary. A longer repeated 400 Mbps pattern is rejected because
this selected model's active transitions overlap.

Quiet channels intentionally have two probes: RX far at the receiver and TX near
at the quiet driver. The drawing labels those endpoints; these are separate
physical nodes, not duplicate measurements.
For DDR3, supply the real 1.2 mm eight-layer physical board JSON and local
`sprm552c.ibs` and `W631GG6MB-12.ibs`. The loader renders 24 addr/cmd declarations
from TSX and preserves physical records. No full DDR transient is run by the tests.

For headless execution, inject `createNativeSolver({ timeoutMs: 10_000 })` from
`@tscircuit/signal-integrity-pipeline/node` and await `solver.solveAsync()`.
Native processes are serialized across adapter instances and use OMP_NUM_THREADS=1.
Stage 5 has no recording/replay input or successful not-run state. Completion is
candidate evidence without independent convergence qualification.

Async debugger stepping is pinned to solver-utils PR #62 and must switch to a
released version once that PR ships. Opt into the bounded two-trace old/new native
comparison with `SI_NATIVE_TESTS=1` and `IBIS_MODEL_DIR`. Vendor-dependent tests
explicitly skip without local files.

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
drawing tests, separate from the real native comparison.

If a real board reaches an existing compiler admission limit, the render script
keeps the completed stages, renders the rejected stage with its reason, and emits
an explicitly upstream-blocked capture drawing. That last image uses the pure
waveform function; it does not imply that the capture solver or ngspice ran. Local
state JSON files contain source inputs and must remain uncommitted with the PNGs.
