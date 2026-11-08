# Signal-integrity pipeline architecture

The public entry consumes Circuit JSON source records from RFC #26. It rejects the
removed modeling option. `pipeline/signals.ts` groups blocks and derives private
settings and native declarations. `pipeline/prepared.ts` runs the existing typed
stage chain after derivation. The lowered transient records are private and never
appear in the new result Circuit JSON.

```mermaid
flowchart LR
  source["Circuit JSON SI records"] --> derive["pipeline: independent block derivation"]
  derive --> board3d["board: 3D routed copper geometry and stackup"]
  board3d --> check{"straight parallel traces,<br/>one rectangular return?"}
  check -->|"yes"| bars["board: extra 2D bar reduction<br/>(cross-section extruded, real coordinates)"]
  check -->|"no"| extract
  bars --> extract["extraction: native R/L/C and convergence"]
  derive --> buffers["buffers: selected vendor models and package networks"]
  buffers --> simulate["simulation: native transient"]
  extract --> simulate
  simulate --> observe["observation: finite eyes and timing"]
  observe --> results["pipeline: RFC result records and artifact ledger"]
```

```mermaid
stateDiagram-v2
  [*] --> input
  input --> admitted: schema and derived settings
  admitted --> declared: geometry and declarations
  declared --> bound: buffers and probe scope
  bound --> extracted: native extraction
  extracted --> simulated: native transient
  simulated --> observed: measurements
  observed --> sealed: results and artifacts
  input --> failed
  admitted --> failed
  declared --> failed
  bound --> failed
  extracted --> failed
  simulated --> failed
  observed --> failed
  sealed --> [*]
  failed --> [*]
```

Module boundaries remain enforced by `check:modules`: modules import one another
through their index, never internals; imports are acyclic; only adapters import
Node facilities. Domain modules return owned artifacts. The pipeline ledger
rejects path collisions and seals files in sorted order. Blocks have separate
artifact prefixes.

`board` owns physical admission and geometry; `buffers` owns vendor source bytes,
pin/model selection and package assembly; `extraction` owns meshes, solver decks,
parsing, passivity and convergence checks; `simulation` owns electrical sources,
node identity and ngspice; `observation` owns interpolation and measurements.
`report` reads sealed artifacts. `adapters` supplies explicit filesystem/process IO.

Tests use TSX for board reproductions. Numerical measurement oracles use analytic
waveforms; those synthetic waveforms are never claimed as native solver evidence.
The old compatibility snapshots for the removed modeling API require migration;
the RFC intentionally changes the public entry, records and artifact paths.
