## What is it?

Native signal-integrity simulation for tscircuit boards. Describe each test with
`<signalintegrity>` and `<signal>`; the pipeline consumes the resulting Circuit JSON,
extracts coupled copper with FastHenry/FasterCap, and runs IBIS buffers in ngspice.
This draft implements the pipeline entry of [RFC #28](https://github.com/tscircuit/rfc/pull/28).

## How to use it?

```tsx
<signalintegrity name="DATA_TEST" bitRate="20Mbps">
  <signal name="DATA" driver=".TX > .Y" receiver=".RX > .A" />
</signalintegrity>
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
the RFC's five new result record kinds. Re-running replaces prior SI results. A board with no SI blocks returns an empty block/result collection without invoking a solver. Automatic duration stays absent in source records and is reported on each result block.

The draft explicitly rejects extracted PDN, branched routes and coupled package matrices; the RFC lists these as not implemented yet.

See [the TSX levels](examples/levels) and [native evidence](docs/native-signal-levels.md).
The installed core predates the sibling intrinsic-element PRs: the native runner
uses a temporary adapter to render physical TSX and emit the new source records.
It never substitutes synthetic IBIS. Vendor files remain local and ignored by git.

```sh
pnpm install --frozen-lockfile
# While circuit-json#983 is unpublished, build that sibling and overlay its dist locally.
IBIS_MODEL_DIR=/path/to/vendor/models node --import tsx scripts/run-signal-levels.tsx
```

FastHenry, FasterCap and ngspice must already be installed. The evidence runner
uses `/opt/homebrew/bin`; the Node adapter accepts executable paths for other hosts.
No package install or solver download happens during `runPipeline`.

## General workflow

```mermaid
flowchart TD
  board[/"Your board<br/>(Circuit JSON with signalintegrity blocks)"/] --> s1["1. Read the board, group the blocks, derive drivers, receivers, pin states and patterns<br/><small>pipeline</small>"]
  chips[/"Chip models<br/>(IBIS files)"/] --> s4
  s1 --> s2["2. Build the 3D copper geometry: routed traces, vias, pours, stackup<br/><small>board</small>"]
  s2 --> q{"Straight parallel traces over<br/>one rectangular return<br/>with contacts at opposite ends?"}
  q -->|"yes"| s2b["2b. Extra: replace the 3D copper with straight bars<br/>(a 2D cross-section taken from the real coordinates, extruded along the length)<br/><small>board</small>"]
  q -->|"no"| s3
  s2b --> s3["3. Measure the wires: R, L, C, refining the mesh until it converges<br/><small>extraction</small>"]
  s3 <-->|"runSolver"| fs{{"FastHenry + FasterCap"}}
  s3 --> s4["4. Build one circuit per block: wires + chip buffers + packages<br/><small>buffers, simulation</small>"]
  s4 --> s5["5. Solve undisturbed idle, then signals; independently refine sections and timestep until RMS and signed peaks converge<br/><small>simulation</small>"]
  s5 <-->|"runSolver"| ng{{"ngspice"}}
  s5 --> s6["6. Measure: eyes, NEXT/FEXT, strobe margins<br/><small>observation</small>"]
  s6 --> out[/"Result records + solver evidence"/]
```

```mermaid
stateDiagram-v2
  [*] --> validate
  validate --> derive
  derive --> extract: 3D copper model (2D bars if straight parallel)
  extract --> extract: refine mesh
  extract --> simulate: converged
  simulate --> simulate: refine sections and timestep
  simulate --> measure: RMS and signed peaks converged
  measure --> simulate: automatic strobe duration needs extension
  measure --> sealed
  validate --> failed
  derive --> failed
  extract --> failed
  simulate --> failed
  measure --> failed
  sealed --> [*]
  failed --> [*]
```

Missing electrical facts fail explicitly. Numerical settings come from selected
IBIS edge rates, bit rates, stackup and actual routes. Matrix order follows stable
physical pin identities, and coupling follows copper positions. The 3D routed
copper geometry is always built first. Only when the traces are verified straight,
parallel and over one rectangular return with opposite-end contacts is it replaced by straight bars (step 2b);
every other route is extracted from the 3D geometry. In that case `geometry.json`
holds the bars, not the 3D copper.

Every block produces an independent run. A differential endpoint drives opposite
physical levels and measures P minus N. Quiet signals remain connected, with
near/far probes and no eye. Single-ended probes use their chip's ground unless
`probe="global"` is requested. The settling gate is the largest switching offset plus 16 UI. Eyes use the RFC sampling instants and IBIS DC thresholds at the selected corner; differential DC thresholds override `[Diff_pin]`. Quiet peaks are signed deviations from a separate undisturbed idle solve, never the switching waveform mean.

Results describe finite observed simulations. They do not establish BER, protocol
compliance, hardware accuracy, or a validated DDR memory interface. The evidence
document distinguishes verified fixtures from outstanding implementation limits.
