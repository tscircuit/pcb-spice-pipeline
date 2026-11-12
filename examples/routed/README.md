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
