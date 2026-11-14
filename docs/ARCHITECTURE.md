# Signal-integrity pipeline architecture

`RoutedPipelineSolver` is the public entry. It consumes Circuit JSON source records
from RFC #28. `pipeline/signals.ts` (`prepareBlockById`) groups blocks and derives
private settings and native declarations, one block per admission step. The lowered
transient records are private and never appear in the input Circuit JSON.

```mermaid
flowchart LR
  source["Circuit JSON SI records"] --> admit["pipeline: independent block admission<br/>buffers: package admission, unlisted-pin hierarchy and passivity"]
  admit --> sections["board: copper scope, straight sections and reference planes"]
  sections --> fields["extraction: quasi-TEM cross-sections, pair screen and causal loss"]
  admit --> bindings["buffers + simulation: vendor models, pin packages, ideal die rails, probes and sources"]
  fields --> network["simulation: coupled ladders, via and oblique corrections, one deck"]
  bindings --> network
  network --> transient["simulation: one native ngspice transient per block"]
  transient --> output["pipeline: captures and the sealed artifact ledger"]
  admit -->|"no SI blocks"| output
```

Module boundaries remain enforced by `check:modules`: modules import one another
through their index, never internals; imports are acyclic; only adapters import
Node facilities. Domain modules return owned artifacts. The pipeline ledger
rejects path collisions and seals files in sorted order. Blocks have separate
artifact prefixes.

`board` owns physical admission, the copper scope, route sections and board drawings;
`buffers` owns vendor source bytes, pin/model selection and package assembly;
`extraction` owns cross-section field solves, route lines, pair coupling and matrix
checks; `simulation` owns declarations, electrical sources, node identity, the routed
deck and ngspice; `observation` reads native ngspice vectors; `solver` validates
native runs. `adapters` supplies explicit filesystem/process IO.

`buffers/package-model.ts` parses local IBIS package definitions;
`package-matrix.ts` validates the complete matrices and reduces unused floating
pins; `coupled-package.ts` emits the coupled lumped pi circuit. Admission runs
during block admission, before extraction. Assembly records selected matrices,
original self terms, unused pins, merged rail associations and the termination policy.
Unlisted pins follow the IBIS scalar hierarchy or implicit merged rail bus rules.
Core only checks declaration/model bindings, capabilities and routing. The converter still
supplies die buffers with its package omitted; the pipeline must then realize
the selected vendor package. See [the electrical contract](coupled-package-model.md).

Tests use TSX for board reproductions. Synthetic engine responses exercise parsing
and drawing only; they are never claimed as native solver evidence.

The runtime imports the shared circuit-json schemas. Local validation must build the sibling RFC branch until circuit-json#983 is released. No absolute local dependency links are committed. TSX tests and examples use the built core directly.

Core#5286 emits JLC preset plating (0.018 mm), preserving explicit imported stackup plating; routed vias require it. RFC pours request ground escape routing with `unbroken`; the differential example uses manual paths and retains its original autorouter reproduction. Branched routes and cycles remain unsupported.

## 2D extraction

`extraction/cross-section.ts`, exported by `extraction/index.ts`, owns a separate
quasi-TEM numerical interface. It consumes rectangles, infinite solid references,
and dielectric/mask slabs and returns per-unit-length C/C0/L and frequency-dependent
R/G. `RouteFieldsSolver` consumes it; see
[routed 2D candidate and execution blockers](routed-2d.md). The routed root owns its
single ledger fold after all block stages complete. See
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
  result --> routed[Routed pipeline: arc-cell energies and causal ladders]
  routed --> pilot[Bounded native pilot and failure evidence]
```

## Routed coupling

`board` admits candidate nets within 32 mm unless the problem narrows the scope.
`extraction/route-coupling.ts` solves parallel pairs before assembling final
cross-sections; either normalized mutual C or L at least 0.5% retains the pair.
The cap, 40-conductor guard and omissions are recorded.

```mermaid
flowchart LR
  board[Physical routed copper] --> cap[Board candidate-net admission and reference slicing]
  cap --> pair[Extraction solved parallel pair screen]
  pair --> field[Extraction retained 2D cross-sections]
  field --> ladder[Simulation route-arc energy assembly]
  ladder --> native[Guarded serial native transient]
  native --> verdict[Candidate capture, unqualified]
```

## Inspectable routed compiler

Stage classes live with their domain knowledge. Root admission calls
`prepareBlockById` once per SI block. Each admitted
block is passed through the same six static top-level stages. The entire
`pipelineDef` exists before admission starts; no step creates stages at runtime.
`RoutedStageSolver` steps each domain algorithm across all admitted blocks in
order, one domain item per step, and publishes an immutable array in admission
order. It is a `BaseSolver`, with no nested pipeline or child debugger rows.
The single `routedStages` tuple supplies the debugger order, tests, artifact
manifest and generated docs below.
Regenerate with `pnpm exec tsx scripts/document-routed-stages.ts`.

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

`RouteFieldsSolver` owns its geometry-keyed BEM cache; completed snapshots contain
numeric coefficients without Maps or frequency callbacks. `routedSimulation`,
its bulk `extractRoutes` loop and caller-owned field cache are deleted. Segmentation
and ladder generators retain one canonical algorithm, also drained by existing
numerical primitive callers. Network stepping creates one route run's cells;
its final step assembles the coupled global matrices, oblique/via terms and deck.
One BEM solve is atomic. The 40-conductor limit remains enforced. Route-arc
energies store only nonzero entries integrated from common slices, capped at
500,000 entries across R/L/skin/C/dielectric matrices. A non-dominant shunt
requiring dense modal realization separately caps its allocation at 500,000
entries. Neither guard depends on a raw 1,024-cell limit.

Coupled series resistance uses a normalized reciprocal multiport. For
`S = diag(sqrt(Rii))`, its auxiliary node voltages are `x = S I`, its
unit-diagonal conductance matrix is `S^-1 R S^-1`, and opposite VCCS stamps
enforce `V = R I`. This congruence preserves signed mutual resistance and
passivity without dense inversion. Uncoupled rows use ordinary resistors.
The former zero-volt sensors and series CCVS chains lost numerical accuracy
at near-zero Foster voltages on large, weakly anchored neighbour networks.
Replacing that realization deliberately changes routed deck bytes and their
pins; field coefficients, loss poles, topology and solver tolerances stay fixed.

Causal skin loss is one coupled layer, not nine. Every Foster pole scales the
same matrix, so `Z(s) = z(s) S`. Rows without mutual terms keep scalar R || L pole
stages. Coupled rows share one normalized multiport: a series VCCS carries
`I = x / sqrt(Sii)`, the auxiliary KCL is `sum_j Sn_ij u_j = V / sqrt(Sii)`, and a
grounded unit Foster stage sequence gives `u = z(s) x`. The former per-pole multiports
and `K` layers stacked nine copies of the coupling graph, which caused 8.9M LU fill
on the DDR3 deck. Those auxiliary rows have no diagonal, so routed decks set
`pivrel=0.1`. `klu_refactor` reuses the pivots chosen on the first transient
iteration, and the default `1e-3` lets the first time point fail. Measurements are in
`docs/research/ngspice-step-profile.md`.

Completed domain values are copied and frozen. Only the root folds the six stages'
`Produced` artifacts into `ArtifactLedger`; runtime timings stay in `stats`.
Original assumptions, coupling decisions, reference omissions, external ports,
model provenance, node maps, via/oblique policies and deck evidence remain visible.

The site's `Step` input starts at 0 for the initial board, then synchronizes to
stages 1–6, matching table rows 01–06. Entering a number
selects that retained stage until the next pipeline advance. Each flat stage
retains its last completed block's domain solver and final drawing; selecting
an earlier stage never recomputes it. Each domain solver draws its physical input
before its first step. Stage wrappers construct that domain solver when admitted,
and root transitions preview the incoming immutable input before the next step.
Fields preview the first physical cross-section without solving coefficients.
Pending transients show the board with probe marks and empty plot axes; curves
appear only after complete samples arrive. Future stages whose inputs are
incomplete draw the selected copper in neutral grey, and a problem with no admitted
blocks shows the whole board with one quiet line. Values outside 0–6 are clamped silently; clicking
a table row also selects that stage. Selection lives in fixture component state.
The page starts with this input and the debugger; local asset loading remains,
while only blocking load, backend and solver errors appear inline.

Every stage draws in board millimetres, y up, inside one fixed camera per problem
(`routeView`): the selected copper and its endpoint parts (a large package only near
the copper), plus a pane slot on the side that brings the camera nearest 1.6:1. Every
stage and every failure shares that camera; failure reasons are written in the pane.
Nets are coloured by electrical connectivity, one hue per net, and a differential
channel's two legs are two shades of one hue. Channels, bit periods and pairs come from
`simulation_signal` records, or from an admitted block's `simulation_digital_stimulus`
records. Copper keeps its real width, and its layer is in the stroke: top solid, inner
layers hollow, bottom dimmed. Each stage draws what it produced:

| Stage | Board | Pane |
|---|---|---|
| Admission | selected nets, drivers as dots, receivers as rings | each net's routed length, to scale |
| Sections | sections in two tones of the net's hue, the route cut this step cased white, uncut copper grey | the same partition unrolled per net |
| Fields | solved copper coloured by Z0, an amber cut at the slice on screen | that slice's stack at one mm scale, Z0 of selected conductors, coupling bands sized by k, the Z0 scale |
| Bindings | bound parts outlined, ▶ at drivers and ◁ at receivers along the trace | each bound net with its buffer glyphs |
| Network | coupling bands between parallel sections (width grows with k), cell ticks, modelled vias | cells and coupling unrolled per net |
| Transient | probe marks | an eye folded every two bit periods when the capture is long, else the window from the first activity; IBIS Vinl–Vinh of single-ended receivers as a band; above six far-end probes an envelope plus the worst curve; amber hatching while ngspice runs |

Only Z0 values, axis ticks, strip names and lengths, and a failure reason are written;
silkscreen text never reaches the picture. Every net, mark and curve carries its net
label, so the site can link them on hover.

`src/board/board-picture.ts` puts the real board under that drawing. `circuit-to-svg`
renders a dimmed top view (soldermask, pads, silkscreen lines) of only the records
near the camera, through a `viewport` equal to it. The overlay is graphics-debug's own
SVG, cropped by `viewBox` to the camera frame it finds in that SVG, so objects outside
the camera never move it. Both layers are letterboxed in the same box. The site
stacks the two layers; ctrl/⌘ + wheel zooms 1–20× and dragging pans, and after a
pause the visible region is re-rendered with labels at the same size. Hovering a
labelled object dims the others and names it. Stage drawings are cached per solver
state. Only the site, scripts and tests import the module, so `circuit-to-svg` stays a
development dependency outside the library bundle. Display sampling caps object counts;
numerical inputs and native samples remain complete.

`RouteTransientSolver` awaits one `solver.invoke` call in `_stepAsync`. Its
self-contained `.save` + `.tran` deck keeps KLU and Gear in native batch ngspice.
Native batch emits ASCII raw vectors (`SPICE_ASCIIRAWFILE=1`). Diagnostics, finite
samples, start and final simulated time are checked before publishing a capture.
Errors leave the stage failed without partial output. Native adapter instances
share a process queue and set OMP_NUM_THREADS=1. Large DDR3 transients remain
unverified. Completion is candidate evidence without independent convergence
qualification.

Async stepping uses solver-utils PR #62 at `127f17012c7c391005254993864b26801f418249`
through an integrity-locked pkg.pr.new URL. Switch to a release after #62 ships.

### Cosmos development backend

`vite.config.ts` installs `createSolverMiddleware` in Cosmos's Vite renderer.
The Cosmos UI listens on 127.0.0.1:5000; the renderer and API listen on
127.0.0.1:5050. The plugin's config hook overrides Cosmos 6's inline wildcard
host. The renderer URL is explicitly IPv4 loopback, matching the API's Host and
Origin checks. `createHttpSolver` is a browser-safe adapter inside `adapters`;
it adds no Node imports to the fixture graph.

```mermaid
stateDiagram-v2
  [*] --> validate: POST /api/run-solver
  validate --> rejected: invalid JSON / size / solver / paths / flags / origin
  validate --> queued: accepted request
  queued --> rejected: queue full
  queued --> running: single slot available
  running --> completed: result and output files
  running --> failed: native error or 45 min timeout
  completed --> [*]: release slot and clean temp directory
  failed --> [*]: release slot and clean temp directory
  rejected --> [*]
```

Version probes share the queue, and the existing native adapter enforces
OMP_NUM_THREADS=1. The request cannot override tools or cwd. Local asset reads
are limited to the four known example IBIS filenames under IBIS_MODEL_DIR and
the board file selected by SI_DDR3_BOARD; URLs cannot select filesystem paths.
These assets are loaded at runtime and never part of a published static bundle.
