# pcb-spice-pipeline

Executable local workflow: tscircuit TSX or routed Circuit JSON → native FastHenry R/L and FasterCap C → referenced passive distributed SPICE channel → reusable vendor IBIS converter → native ngspice → measured transient and clock eye.

This repository implements a **reduced, straightened two-signal channel**, with an explicit finite return conductor per stage. It does not extract a full board, its plane cutouts or all neighboring copper. Geometry/material choices and omissions are saved with every run. No extraction values or successful solver outputs are hard-coded.

## Regenerate and execute everything

From this repository, run:

```sh
./scripts/reproduce.sh
```

The script installs locked Node dependencies, builds pinned FastHenry/FasterCap/ngspice sources locally, installs pinned plotting dependencies into `.venv`, runs unit and real native integration tests, and regenerates **each example twice from geometry and original vendor files**. It prints the new `runs/proof-*/summary.json` path. Existing run directories are never overwritten or used as solver output caches.

Requirements: Node ≥22, pnpm 11.25.0, Python ≥3.10, a compiler, Git and network access for source/vendor downloads. macOS uses Xcode command-line tools and Homebrew; Linux setup uses apt/sudo. The bootstrap also finds this Mac's bundled Codex Node/pnpm when they are absent from PATH. Native dependencies are installed by the setup script; their actual versions are recorded rather than falsely claimed identical across hosts. The completed proof on this Mac uses native Darwin arm64 executables, without SSH or containers. Linux CI is supplied but has not been claimed executed from local Mac proof.

Individual fresh runs after setup:

```sh
pnpm example                         # tractable 10 mm synthetic channel
pnpm routed                          # real routed TI → Winbond stage lengths
pnpm tsx                             # render source TSX and extract its geometry
pnpm test:native                     # actual native integration + analytic C check
node src/cli.mjs examples/am3352.json --out runs/my-fresh-run
```

The named npm scripts use fixed output paths and will ask you to choose a fresh path through a diagnostic if those paths already exist. `pnpm prove` automatically chooses a fresh proof directory.

## Inputs and API

JSON entry files point to a Circuit JSON array (plain or `.json.gz`) and declare modeling inputs. The mesh-preparation object called `model.json` in the earlier work is deliberately rejected as Circuit JSON. `examples/am3352.json` uses the original gzipped Circuit JSON, with its uncompressed SHA-256 checked before extraction.

TSX entry modules export a default board and `modeling`; `Circuit.renderUntilSettled()` generates source connectivity, physical ports and route centerlines. The included TSX example declares native `<chip ibisModel={...}>` on both chips using the **experimental, unpublished patched core/props tarballs** pinned in `vendor/native-ibis-packages-handoff.json`. Released core 0.0.2149 alone does not support this prop. Root dependency overrides keep every nested props/converter import on the pinned packages.

With `requireNativeIbis=true`, the pipeline requires exactly one native `simulation_spice_subcircuit` per selected chip, validates its returned source-port IDs against lane/supply mappings, compares its source with independent conversion of the original vendor bytes, and uses the **native emitted source and terminal mapping** in the executed extracted-channel netlist. Its receipt contains `native-ibis-assembly.json`. No ordinary `analogsimulation` is declared on this TSX board; the pipeline inserts the extracted channel before running ngspice. A module may instead export `circuitJson`. Source/receiver nodes are assembled separately, so an ideal tscircuit trace cannot short across the extracted channel.

```js
import { loadEntry, runPipeline } from 'pcb-spice-pipeline'
const receipt = await runPipeline({
  ...await loadEntry('examples/am3352.json'),
  outputDir: 'runs/api-fresh-run',
  onProgress: console.log,
})
```

The `runPipeline` API also accepts `{circuitJson, modeling, outputDir, tools}` directly. `tools` contains explicit `fasthenry`, `fastercap`, `ngspice` paths; defaults come from `.cache/tools/tools.json`, or `PCB_SPICE_TOOLS`. `PCB_SPICE_PYTHON` can override `.venv/bin/python3` for plotting.

Required physical modeling inputs include Circuit JSON units (`mm`), conductivity (`S/m`), copper layer z ranges (`mm`), explicit per-stage signal separation, finite return dimensions/position, and homogeneous effective permittivity. The two lanes explicitly map source/receiver physical ports and vendor buffer ports. Ordered route layers, lengths, widths, XY endpoints and recorded hole diameter come from Circuit JSON. Via plating is an explicit assumption; the example uses 25 μm. The equivalent rectangular via preserves plated barrel metal area; omitted through-via stubs must be explicitly acknowledged. Missing inputs, stale endpoint IDs, nonfinite coordinates, unsupported branching/topology, width changes, layer discontinuities and conductor overlaps fail with useful diagnostics.

## Electrical convention and verification

FastHenry primitive ports are `[sig0,sig1,return]`, each oriented from source to receiver. All external port labels are checked against the generated deck. With return current `Ireturn=−I0−I1`, the loop impedance is `Aᵀ Z A`, where `A=[[1,0],[0,1],[-1,-1]]`. `R=Re(Z)` is in ohms; `L=Im(Z)/(2πf)` is in henries. Both off-diagonal resistance and signed mutual inductance are retained.

FasterCap uses closed **3D** box surfaces in metres; its full 3×3 matrix is in farads relative to infinity. Returned conductor labels are verified. We eliminate common voltage with total charge zero: `Cloop=Css−(C1)s(1ᵀC)s/(1ᵀC1)`. This is an isolated neutral group with voltages relative to its finite return. It is not a grounded infinite plane. The retained two-signal Maxwell C gives mutual capacitance `−C12` and shunt capacitances from the row sums, each split between pi-section endpoints.

Each whole-stage matrix is divided into explicit uniform pi sections. R is realized by diagonal resistors and cross-current controlled voltages; L by self inductors and signed K. Symmetric positive definiteness of the full R/L matrices establishes positive dissipative/stored energy even when a mutual term is negative. No arbitrary numerical RLC floors are inserted.

Executed gates include:

- Primitive/referenced matrix reciprocity and positive Cholesky pivots before SPICE emission; symmetry averaging only follows the raw residual check.
- DC rectangular-conductor analytic resistance and the full shared-return loop matrix, including its cross resistance.
- FastHenry model-frequency mesh refinement, with the full referenced R/L residuals recorded and bounded. The refined matrix feeds SPICE. This tests the selected model frequency, not the entire saved spectrum.
- FasterCap's final automatic-refinement residual, followed by neutral charge and electrostatic energy reconstruction.
- An independent, freshly generated wide parallel-plate **2D** C check in F/m; finite-edge fringing is compared with `εw/g`. This check is never substituted for the channel's 3D extraction.
- Executed source clock/UI consistency, distinct source/receiver pads, finite monotonic waveform samples and measurable steady transitions.
- Byte-identical regenerated SPICE, original input snapshots, native solver matrix files and waveform/measurement outputs, using comparable freshly executed inputs.

The spectrum is retained, but the distributed channel is a **constant R/L model at 100 MHz**, with static effective permittivity and no fitted dispersion. It has no dielectric loss, roughness, bend/meander coupling, neighboring nets, realistic plane impedance or board pad capacitances. Filament convergence does not establish broad-band model accuracy. The folded eye is an alternating deterministic DQS clock, with no random data or injected jitter; it is not a BER or JEDEC compliance result.

## Vendor integration and provenance

The reusable MIT-licensed `@tscircuit/ibis-to-spice@0.0.1` package is installed from the local immutable tarball in `vendor/`, pinned to commit `4292a5a23ce6b33ade8abbd238685c1790845bb7` and SHA-256 `6da6c9aacb4c71f66ed7573d1d6be9d636dd144eabf39e44eba968d8f42feffd`. This pipeline calls its public API and returned terminal mappings; it does not reimplement IBIS parsing/conversion. Original TI and Winbond ZIP/IBIS bytes are downloaded and hash checked against its locks, then preserved as local run inputs. No proprietary model archive is packaged in repository source.

The example binds TI `am335x_zcz` P1/Model_655 and P2/Model_847 to Winbond `W631GG6MB-12` F3/G3 with ODT_60. Both use local VDD/VSS references. TI's coupled package is excluded by explicit `packageModel="none"`; Winbond uncoupled pin RLC is included. These are demonstration buffer/ODT settings, not known board firmware. V/T fixture consistency is not independent silicon validation.

The original routed board fixture comes from [circuit-json-to-gmsh](https://github.com/tscircuit/circuit-json-to-gmsh), commit `9c7f34b7e502b8339a6659cb268b1540867a672d`, with source [astra/am3352-sbc](https://tscircuit.com/astra/am3352-sbc#files). Its repository notice is preserved in `examples/fixtures/LICENSE`; the original JSON hash is recorded in the config. Correct physical routes are U1.P1→U3.F3 and U1.P2→U3.G3. The selected stackup is a repository modeling assumption, not manufacturing sign-off. Their meander centerlines are retained in receipts, while extraction uses stage lengths of roughly 44.80/44.92 mm plus explicitly modeled active via lengths.

## Evidence and licenses

Each run preserves original inputs/hashes, solver decks/panel files, full primitive matrices, conversions and checks, SPICE, command lines, working directories, stdout/stderr, exit codes, execution host/binary hashes, tool build revisions, waveform CSV, measured metrics, PNG/SVG plots and a SHA-256 receipt. Source-build commands/logs/patches/notices remain under `.cache/tools`. FasterCap's macOS memory-query diagnostic says it continues in-core; this is retained verbatim and these tractable cases complete successfully.

The integration code is MIT; solver licenses are independent. **FastHenry's original MIT-era notice restricts internal noncommercial use and redistribution**; do not interpret its institutional name as the permissive MIT software license. The installer fetches it locally and preserves its notices. No solver source/binary is tracked, redistributed or uploaded as a CI artifact. FasterCap/Geometry/LinAlgebra notices and ngspice's component notices also remain intact. See `toolchain-lock.json` and the downloaded originals for exact notices.

Nothing is published to npm or a public repository by these scripts.
