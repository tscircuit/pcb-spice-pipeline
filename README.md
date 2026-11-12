## What is it?

Native signal-integrity simulation for tscircuit boards. Describe each test with
`<simulation.pcbtransientchannelsimulation>` and `<signal>`; the pipeline consumes the resulting Circuit JSON,
extracts coupled copper with FastHenry/FasterCap, and runs IBIS buffers in ngspice.
This draft implements the pipeline entry of [RFC #28](https://github.com/tscircuit/rfc/pull/28).

## How to use it?

```tsx
import { simulation } from "@tscircuit/core"

<simulation.pcbtransientchannelsimulation name="DATA_TEST" bitRate="20Mbps">
  <simulation.pcbchannel name="DATA" driverRef=".TX > .Y" receiverRef=".RX > .A" />
</simulation.pcbtransientchannelsimulation>
```

```ts
import { runPipeline } from '@tscircuit/signal-integrity-pipeline'
import { createNativeSolver, loadIbisSources, writePipelineOutput } from '@tscircuit/signal-integrity-pipeline/node'

const result = await runPipeline({
  circuitJson,
  ibisSources: await loadIbisSources({ circuitJson, baseDir: '.' }),
  runSolver: createNativeSolver(),
})
await writePipelineOutput({ result, outputDir: 'runs/si' })
```

Circuit JSON is the electrical input. `ibisSources`, `runSolver` and `onProgress`
are IO ports. There is no `modeling` option or separate simulation configuration.
Each `result.blocks` entry owns its matrices, results, numerical settings evidence
and limitations. `simulationResultCircuitJson` retains the input and appends only
the RFC's waveform and RLGC result record kinds. Re-running replaces prior SI results. A board with no SI blocks returns an empty block/result collection without invoking a solver. Automatic duration stays absent in source records and is reported on each result block.

Branched routes remain unsupported. Inline IBIS coupled package matrices are
validated before extraction and lowered to a passive lumped package. Unlisted
pins follow the IBIS [Pin]/[Package] hierarchy and merged rail bus rules;
missing or invalid matrix definitions still fail. See the
[package model contract and DDR3 blockers](docs/coupled-package-model.md).
Die POWER/GND references always connect directly to perfect rails;
vendor package R/L/C remains between every mapped pin and its die node. See the [model rationale](docs/native-signal-levels.md).

See [the TSX levels](examples) and [native evidence](docs/native-signal-levels.md).
Local native verification uses the sibling core build through `SI_CORE_MODULE`;
its real TSX rendering emits the source records without a rendering adapter.
It never substitutes synthetic IBIS. Vendor files remain local and ignored by git.

```sh
pnpm install --frozen-lockfile
# While circuit-json#983 is unpublished, build that sibling and overlay its dist locally.
IBIS_MODEL_DIR=/path/to/vendor/models node --import tsx scripts/run-signal-levels.tsx
```

FastHenry, FasterCap and ngspice must already be installed. The evidence runner
uses `/opt/homebrew/bin`; the Node adapter accepts executable paths for other hosts.
No package install or solver download happens during `runPipeline`.

For an oversized full-resolution result, `files` stores waveform records in separate
`circuit-results/waveform-*.json` parts. `circuit-results.index.json` lists each
part's original record positions; `circuit-results.json` then holds the other
records. Reassembling those indexed parts preserves every sample and record.
Ordinary-sized aggregate artifacts keep their existing format, and
`simulationResultCircuitJson` always contains the complete in-memory result.
Consumers should write the supplied `files` map and its index for oversized data.
CLI #5736 still needs to guard its additional aggregate `JSON.stringify` so it can
use these indexed parts rather than hitting the same V8 string limit.

### Local fixture site

Run `bun install && bun dev` with **ngspice on PATH**. Cosmos opens
[http://127.0.0.1:5000](http://127.0.0.1:5000); its Vite fixture renderer and local
API use port 5050. Both bind only to `127.0.0.1`.

The sidebar lists the two-trace TSX board, every signal level, the DDR3 addr/cmd
scope, and a paste/upload Circuit JSON page. Each mounts `GenericSolverDebugger`
with `RoutedPipelineSolver`. Step through admission, geometry, fields, buffers,
network assembly, then the live local ngspice transient. Captures remain candidate
results without independent convergence qualification.

Set `IBIS_MODEL_DIR` to the examples' local vendor directory (default `models`).
Set `SI_DDR3_BOARD` to the real physical DDR3 board JSON for the addr/cmd page.
Missing files show `missing local asset: <path>`. Each fixture loads models from
local paths. Vendor assets and board JSON are never bundled or committed.
The site requires its local backend.

```mermaid
flowchart LR
  fixture["Cosmos TSX / uploaded Circuit JSON"] --> debugger["GenericSolverDebugger · routed stages 1–6"]
  assets["Fixed local model paths / SI_DDR3_BOARD"] --> debugger
  debugger --> transient["RouteTransientSolver · stepAsync"]
  transient <-->|"POST /api/run-solver · HTTP RunSolver"| queue["Vite middleware · single slot"]
  queue <-->|"isolated temp dir · 120 s limit · OMP_NUM_THREADS=1"| native["Local ngspice on PATH"]
  transient --> capture["Actual waveform samples"]
```

The backend accepts bounded JSON bodies (16 MiB), checks same-origin loopback
requests, rejects other solvers and executable/cwd options, and serializes native
runs and version probes. `GET http://127.0.0.1:5050/api/solvers` reports ngspice
availability and version. A missing binary shows `ngspice not found on PATH`.

## General workflow

```mermaid
flowchart TD
  board[/"Your board<br/>(Circuit JSON with transient channel blocks)"/] --> s1["1. Read the board, group the blocks, derive drivers, receivers, pin states and patterns<br/><small>pipeline</small>"]
  chips[/"Chip models<br/>(IBIS files; coupled package admission)"/] --> s1
  chips --> s4
  s1 --> s2["2. Build 3D copper and layered dielectric; join series paths and retain receiver taps<br/><small>board</small>"]
  s2 --> q{"Straight parallel traces over<br/>one rectangular return<br/>with contacts at opposite ends?"}
  q -->|"yes"| s2b["2b. Extra: use straight bars for R/L<br/>(C keeps the full copper and layered dielectric)<br/><small>board</small>"]
  q -->|"no"| s3
  s2b --> s3["3. Extract R/L and layered C; check mesh convergence, reciprocity and passivity<br/><small>extraction</small>"]
  s3 <-->|"runSolver"| fs{{"FastHenry + FasterCap"}}
  s3 --> s4["4. Build one circuit per block: wires + chip buffers + scalar/coupled pin packages + ideal die rails<br/><small>buffers, simulation</small>"]
  s4 --> s5["5. Solve undisturbed idle, then signals; independently refine sections and timestep until RMS and signed peaks converge<br/><small>simulation</small>"]
  s5 <-->|"runSolver"| ng{{"ngspice"}}
  s5 --> s6["6. Emit receiver waveforms, quiet near/far idle levels and listed-leg RLGC<br/><small>observation</small>"]
  s6 --> out[/"Result records + solver evidence"/]
  s1 -->|"no SI blocks"| out
```

```mermaid
stateDiagram-v2
  [*] --> validate
  validate --> derive
  validate --> sealed: no SI blocks
  derive --> extract: 3D copper model (2D bars if straight parallel)
  extract --> extract: refine mesh
  extract --> simulate: converged
  simulate --> simulate: refine sections and timestep
  simulate --> record: RMS and signed peaks converged
  record --> sealed
  validate --> failed
  derive --> failed: missing electrical facts or invalid package matrices
  extract --> failed
  simulate --> failed
  record --> failed
  sealed --> [*]
  failed --> [*]
```

The browser-safe routed pipeline is inspectable with solver-utils. It is a
candidate 2.5D path; `runPipeline` still runs the 3D workflow above in this PR.
Construct `new RoutedPipelineSolver(problem, { runSolver, progress })` and await
`solver.solveAsync()`. All six stage rows exist before the first step; each stage
processes all admitted blocks in order, with no nested block pipelines. The site's
`Step` input starts at 0 for the initial view. Enter 1–6 to inspect a retained stage
by table row number; the next pipeline advance updates the input to the active
stage. Unrun stages show a not-run note. Synchronous stages can still be stepped
up to stage 6;
`RouteTransientSolver` awaits one live ngspice run and admits complete probe vectors.
Inject the local native adapter to run stage 6 with a bounded process timeout.

<!-- routed-stages:start -->
| # | Stage solver |
|---|---|
| 1 | RoutedAdmissionSolver |
| 2 | RouteSectionsSolver |
| 3 | RouteFieldsSolver |
| 4 | RouteBindingsSolver |
| 5 | RouteNetworkSolver |
| 6 | RouteTransientSolver |

```mermaid
flowchart LR
  s0["RoutedAdmissionSolver<br/>Admit one SI block per step"]
  s1["RouteSectionsSolver<br/>All admitted blocks, one item per step"]
  s2["RouteFieldsSolver<br/>All admitted blocks, one item per step"]
  s3["RouteBindingsSolver<br/>All admitted blocks, one item per step"]
  s4["RouteNetworkSolver<br/>All admitted blocks, one item per step"]
  s5["RouteTransientSolver<br/>All admitted blocks, one item per step"]
  s0 --> s1
  s1 --> s2
  s2 --> s3
  s3 --> s4
  s4 --> s5
  s5 <-->|"await RunSolver"| engine["local native ngspice"]
```

```mermaid
stateDiagram-v2
  [*] --> RoutedAdmissionSolver
  RoutedAdmissionSolver --> RouteSectionsSolver: all blocks completed
  RouteSectionsSolver --> RouteFieldsSolver: all blocks completed
  RouteFieldsSolver --> RouteBindingsSolver: all blocks completed
  RouteBindingsSolver --> RouteNetworkSolver: all blocks completed
  RouteNetworkSolver --> RouteTransientSolver: all blocks completed
  RouteTransientSolver --> [*]
  RoutedAdmissionSolver --> failed
  RouteSectionsSolver --> failed
  RouteFieldsSolver --> failed
  RouteBindingsSolver --> failed
  RouteNetworkSolver --> failed
  RouteTransientSolver --> failed
  failed --> [*]
```
<!-- routed-stages:end -->

See [the routed debugger](examples/routed/README.md) for the TSX demo and local
DDR3 file loader. Follow-up PR 2 drops 3D and connects this path to `runPipeline`.

Missing electrical facts fail explicitly. Numerical settings come from selected
IBIS edge rates, bit rates, stackup and actual routes. Matrix order follows stable
physical pin identities, and coupling follows copper positions. The 3D routed
copper geometry is always built first. Only when the traces are verified straight,
parallel and over one rectangular return with opposite-end contacts is it replaced by straight bars (step 2b);
every other route is extracted from the 3D geometry. Capacitance retains the physical copper and finite dielectric slabs even when R/L uses the bar reduction. In that case `geometry.json`
holds the bars, not the 3D copper.

Every block produces an independent run. A differential endpoint drives opposite
physical levels and measures P minus N. Quiet channels remain connected and return
near/far waveforms with separately solved undisturbed idle levels. Single-ended
probes always use their chip's local ground. Numeric offsets
are seconds; automatic duration is startup plus 128 of the slowest UI (32 UI for
quiet-only blocks). Explicit durations are never extended. IBIS values always use the typical corner. Public RLGC matrices select only listed legs; all coupled
copper remains in the private model.
