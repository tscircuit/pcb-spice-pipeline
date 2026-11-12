# Routed stage debugger

Run `pnpm install`, then `pnpm routed:debugger` and open the printed localhost URL.
`pnpm exec vite build examples/routed --outDir ../../.cache/routed-debugger` checks
the browser bundle without a server. The runner uses Vite, as solver-utils does,
and the build writes only `.cache/`.
This branch still needs the sibling RFC Circuit JSON/Core/Props builds described
in the architecture notes until those packages are released.

Select the two-trace TSX demo and choose your local `sn74lvc1g04.ibs` file. No vendor
bytes are included in the repository. Inspect/step through the six stages in
GenericSolverDebugger. The waveform stage says **native not run**.

For DDR3, choose the real physical board JSON and local `sprm552c.ibs` and
`W631GG6MB-12.ibs`. The board must be the 1.2 mm eight-layer board. The loader renders
24 addr/cmd declarations from TSX and remaps declaration identities onto that board;
it preserves the physical records. Files remain in the browser. Changing board or
models remounts the solver. No recording replay or synthetic waveform is provided.

For headless execution, solve `RoutedPipelineSolver`, take a block's `compiled`
output and await `executeRoutedDeck(ctx, compiled, scope)`. Pass its `value` to
`new RouteCaptureSolver({ compiled, execution: result.value, artifactPrefix })`.
The execution shell serializes requests. The native adapter sets OMP_NUM_THREADS=1;
use a short timeout for local experiments. This is candidate evidence, without
independent convergence or electromagnetic qualification.

The test suite skips vendor-dependent tests explicitly when local files are
unavailable. Opt into the bounded native two-trace test with `SI_NATIVE_TESTS=1`
and `IBIS_MODEL_DIR`; it uses a four-nanosecond deck and a ten-second process limit.

To render every stage headlessly, run `bun scripts/render-routed-stages.tsx` with
`IBIS_MODEL_DIR` pointing at local vendor files. Set `SI_STAGE_VISUALS_DIR` for the
uncommitted SVG/PNG output directory and `SI_DDR3_BOARD` for the real DDR3 board
JSON. Without that board the script explicitly reports DDR3 as unavailable. Add
`--native-two-trace` for one serial, ten-second-bounded ngspice run and a second
capture image using actual results; otherwise capture shows **native not run**.
`manifest.json` records render paths, display object counts and exact deck hashes.

Visual regression tests use the actual two-trace TSX with original synthetic IBIS
tables for drawing only, so they need no vendor assets. SVG text snapshots include
fills, geometry and visible labels with object labels disabled. After inspecting
the PNGs, regenerate these snapshots with `UPDATE_ROUTED_VISUALS=1 bun test`
followed by the stage test filenames. The pure `routeWaveformDrawing` export takes
only a capture, duration and optional error, so the live transient solver can reuse
it without depending on `RouteCaptureSolver` internals.

If a real board reaches an existing compiler admission limit, the render script
keeps the completed stages, renders the rejected stage with its reason, and emits
an explicitly upstream-blocked capture drawing. That last image uses the pure
waveform function; it does not imply that the capture solver or ngspice ran. Local
state JSON files contain source inputs and must remain uncommitted with the PNGs.
