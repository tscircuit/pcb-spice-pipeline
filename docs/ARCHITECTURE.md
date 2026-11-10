# Signal-integrity pipeline architecture

The public entry consumes Circuit JSON source records from RFC #28. It rejects the
removed modeling option. `pipeline/signals.ts` groups blocks and derives private
settings and native declarations. `pipeline/prepared.ts` runs the existing typed
stage chain after derivation. The lowered transient records are private and never
appear in the new result Circuit JSON.

```mermaid
flowchart LR
  source["Circuit JSON SI records"] --> derive["pipeline: independent block derivation<br/>buffers: package admission, unlisted-pin hierarchy and passivity"]
  derive --> board3d["board: 3D copper, layered dielectric and series receiver taps"]
  board3d --> check{"straight parallel traces,<br/>one rectangular return<br/>with contacts at opposite ends?"}
  check -->|"yes"| bars["board: extra 2D bar reduction for R/L<br/>C retains physical copper and dielectric"]
  check -->|"no"| extract
  bars --> extract["extraction: native R/L and layered C<br/>R/L convergence; signal-block C reciprocity before symmetrization"]
  derive --> buffers["buffers: vendor models, scalar/coupled pin packages and ideal die rails"]
  buffers --> simulate["simulation: undisturbed idle, then native transient<br/>independent section and timestep refinement"]
  extract --> simulate
  simulate --> observe["observation: adaptive waveform convergence"]
  observe --> results["pipeline: RFC result records and artifact ledger"]
  derive -->|"no SI blocks"| results
```

```mermaid
stateDiagram-v2
  [*] --> input
  input --> admitted: schema, derived settings and valid package matrices
  input --> sealed: no SI blocks
  admitted --> declared: 3D copper model (2D bars if straight parallel) and declarations
  declared --> bound: buffers and local probes
  bound --> extracted: mesh copper, native R/L/C
  extracted --> simulated: undisturbed idle, then converged transient
  simulated --> observed: accepted waveforms
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
node identity and ngspice; `observation` owns interpolation and convergence.
`report` reads sealed artifacts. `adapters` supplies explicit filesystem/process IO.

`buffers/package-model.ts` parses local IBIS package definitions;
`package-matrix.ts` validates the complete matrices and reduces unused floating
pins; `coupled-package.ts` emits the coupled lumped pi circuit. Admission runs
during signal derivation, before extraction. Assembly records selected matrices,
original self terms, unused pins, merged rail associations and the termination policy.
Unlisted pins follow the IBIS scalar hierarchy or implicit merged rail bus rules.
Core only checks declaration/model bindings, capabilities and routing. The converter still
supplies die buffers with its package omitted; the pipeline must then realize
the selected vendor package. See [the electrical contract](coupled-package-model.md).

Tests use TSX for board reproductions. Numerical convergence oracles use analytic
waveforms; those synthetic waveforms are never claimed as native solver evidence.
Tests for the removed straightened-stage, legacy fold and DDR assessment paths were deleted. New shared schemas validate every public result. The RFC intentionally changes the public entry, records and artifact paths.

R/L use the signal-minus-return loop transform. C and G use the ground-referenced primitive signal blocks, with all GND pours and GND-connected conductors held at 0 V. The raw C signal block must pass max|C−Cᵀ|/max|C| ≤ 2.5% before (C+Cᵀ)/2 is passed to the symmetric capacitor writer; records contain total matrices indexed by physical conductors, with P/N entries for differential signals. Dielectric loss is currently zero, so G is the signal block of a zero primitive matrix. The transient uses first-order Gear, tight IBIS tolerances, adaptive native samples, and independent time/section refinement. Each probe must pass both integrated RMS and signed peak tolerances (1% + 1 mV). A failure produces no accepted waveforms.

The runtime imports the shared circuit-json schemas. Local validation must build the sibling RFC branch until circuit-json#983 is released. No absolute local dependency links are committed. TSX tests and examples use the built core directly.

Core#5286 emits JLC preset plating (0.018 mm), preserving explicit imported stackup plating. The native runner uses real core. RFC pours now request ground escape routing with `unbroken`; the differential example uses manual paths and retains its original autorouter reproduction. Degree-two copper paths are joined for native extraction, with intermediate receiver pins exposed at their physical arc-length fractions in the uniform pi model. Branches and cycles remain unsupported. The native capacitance deck models each declared dielectric slab and air outside; conductor/dielectric contacts are emitted once. Numerical acceptance, including reciprocity, remains mandatory. See `native-signal-levels.md` for accepted and rejected evidence.

## 2D extraction and routed candidate

`extraction/cross-section.ts`, exported by `extraction/index.ts`, owns a separate
quasi-TEM numerical interface. It consumes rectangles, infinite solid references,
and dielectric/mask slabs and returns per-unit-length C/C0/L and frequency-dependent
R/G. The opt-in `pipeline/routed.ts` experiment now consumes it; see
[routed 2D candidate and execution blockers](routed-2d.md). It is not wired into
the public stage chain above. The root API, 3D extraction,
artifact ledger and simulation behaviour remain unchanged. See
[method, validation and the DDR3 slice demo](2d-cross-section.md).

```mermaid
flowchart LR
  section[Rectangular cross-section and material slabs] --> regions[Split at solid reference planes]
  regions --> fields[Boundary-element material and vacuum solves]
  fields --> capacitance[C and C0]
  capacitance --> inductance[External L from inverse C0]
  fields --> dielectric[Analytic material-energy sensitivity]
  regions --> walls[Two vacuum wall perturbations]
  walls --> skin[Wheeler skin-loss matrix]
  dielectric --> result[Per-unit-length matrices and frequency sampler]
  skin --> result
  inductance --> result
  result --> routed[Opt-in routed candidate: arc-cell energies and causal ladders]
  routed --> pilot[Bounded native pilot and failure evidence]
```
