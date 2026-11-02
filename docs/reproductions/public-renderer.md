# Clean public-renderer integration reproduction

The TSX bridge imports Core for types and accepts a caller-supplied renderer.
The public `tscircuit` package re-exports `Circuit` and declares runtime packages
that a bare Core installation can omit. In particular, its manifest includes
`debug` and `@tscircuit/soup-util`, which the legacy infgrid package imports
without declaring. The infgrid source repository, `tscircuit/autorouting`, is
archived; this reproduction makes no changes there.

Run from a checkout with Node 22 and either package manager on PATH:

```sh
node scripts/reproduce-public-renderer.mjs npm ./npm-result
node scripts/reproduce-public-renderer.mjs pnpm ./pnpm-result
```

Each command creates a fresh consumer containing only pinned `tscircuit`, React
and tsx. It copies the unchanged production `tsx.ts`, `tsx-render.ts` and
`matrices.mjs` files, records their hashes, and imports `Circuit` through the
public package. It then renders a resistor board and checks that serialization
preserves its native records. No cached development node_modules is reused.

Installation is bounded to 180 seconds, rendering to 60 seconds, and install
lifecycle scripts are disabled. The consumer is removed afterwards; the output
directory retains the package-manager version, dependency lockfile when
installation succeeds, phase logs, exit codes and receipt. Exit 0 means the
render and serialization check passed. A failed install is recorded separately
from a failed renderer import or physical render.

This is a diagnostic reproduction, not a claim that every package-manager layout
supports this runtime. No dependencies are added after a failed case. It does
not change the pipeline's package metadata or its committed Core baseline, and
does not run native solvers, validate the imported-board declaration path, or
qualify a full board or eye diagram.

Source ownership checked at:

- Pipeline `ff7013ca660e08196ac531ffbc10c87b2dd26701`: `src/tsx.ts` and `src/tsx-render.ts`.
- Public package `5550501f3a4fe89250851dc5647569c63e42cfd1`: `index.ts`, `package.json`, and `scripts/copy-core-versions.ts`.
- Archived autorouting `02dcdb6ea0c1f5ee14fbce8bac873a72a1a583e4`: `algos/infinite-grid-ijump-astar/package.json`.

The separate Core runtime-peer correction is draft PR
https://github.com/tscircuit/core/pull/5063. Its isolated import regression does
not fix the archived package or the other remaining Core runtime declarations.

## Observed result

Both default clean installations passed with Node 22.17.1, tscircuit 0.0.3052,
React 19.2.4 and tsx 4.23.15. npm 10.9.2 installed in 122.92 seconds and rendered and
serialized in 5.65 seconds. pnpm 10.24.0 installed in 26.03 seconds and rendered
and serialized in 7.75 seconds. The sequential run took 163.67 seconds, peaked
at 1.5 GiB under a 5 GiB cap, and used no swap. Production bridge source hashes
matched in both cases. Each produced one board and 21 native records, preserved
exactly by serialization. The npm lock resolves the public renderer to Core
0.0.2251 and retains infgrid 0.0.35 and soup-util 0.0.41.

The public package's complete runtime installation is a tested startup workaround
for this small native-record path. This is not a fix for the undeclared
dependencies of bare Core or infgrid, nor validation of strict/no-hoist layouts,
every rendering feature, the pipeline's pnpm 11 CI, or imported-board simulation
declarations. Those remain separate tests. No archived repository mutation or
native solver execution is needed for this workaround.
