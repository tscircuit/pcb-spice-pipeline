# Packed TSX consumer schema collision

Installing the pipeline together with `tscircuit@0.0.3052` can put the pipeline's
exact `circuit-json@0.0.534` dependency at the consumer root. Core 0.0.2251 then
resolves that schema through its wildcard peer, while tscircuit gets a nested
0.0.539. Import fails before rendering:

```text
SyntaxError: The requested module 'circuit-json' does not provide an export named 'cad_explosion_move'
```

Align the pipeline schema dependency with current 0.0.541, which includes the
required export introduced by 0.0.539. Update development Core to 0.0.2252,
props to 0.0.716, retaining React 19.2.4 with the public tscircuit 0.0.3053 runtime
providing Core's runtime dependency set. No geometry, native solver or convergence setting changes.

Run with Node 22+ and npm on PATH after installing development dependencies:

```sh
pnpm build
node scripts/test-package-tsx.mjs . ./packed-tsx-result
```

The test installs a fresh consumer with pinned public tscircuit and React,
imports the packed root and `/tsx` entries, renders native simulation
declarations, and verifies saved physical records and pin bindings. It also
checks rejection of added physical traces and unresolved selectors. Installation
scripts are disabled; each process is bounded. It saves the dependency lock,
packed/installed hashes, logs and terminal receipt in the supplied output folder.

To reproduce the failure, run the same script with a built baseline checkout as
its first argument. The normal `pnpm test:package` command includes this test.
The existing peer-free package test remains separate. This fixture does not load
IBIS bytes, execute extraction, or qualify a board or eye. Compatibility beyond
the recorded package versions requires its own test.

A fresh consumer with React 19.3.1 failed with duplicate-React invalid hook calls.
The regression therefore pins compatible React 19.2.4; it does not force the newest
React release or modify external renderer code.
