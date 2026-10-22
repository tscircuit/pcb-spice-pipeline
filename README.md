# pcb-spice-pipeline

Extract coupled PCB interconnects with FastHenry/FasterCap, simulate original IBIS pad models with ngspice, and generate portable HTML waveforms, eye diagrams, CSVs and provenance receipts.

Requires Node 22+. The standalone package builds `dist`, provides the `pcb-spice-pipeline` executable, and exports its API and `pcb-spice-pipeline/tsx` (`ImportedBoard`). Git dependencies build through `prepare`; published npm tarballs include the build. Install scripts must be enabled.

```sh
npm install github:tscircuit/pcb-spice-pipeline#feat/latest-pipeline-pcb-stackup
npx pcb-spice-pipeline --setup
npx pcb-spice-pipeline --check-tools
npx pcb-spice-pipeline index.circuit.tsx --out runs/first
npx pcb-spice-pipeline --repeat index.circuit.tsx --out runs/repeated
npx pcb-spice-pipeline --compare runs/quiet runs/switching --probe DQ0_RX --out runs/comparison
```

For Bun, allow the pipeline's own build in the consuming project's `package.json`:

```json
{
  "trustedDependencies": ["pcb-spice-pipeline"]
}
```

For pnpm 11, allow the pinned GitHub dependency and the pipeline build in the consumer's `pnpm-workspace.yaml` before installation:

```yaml
blockExoticSubdeps: false
allowBuilds:
  pcb-spice-pipeline@git+https://github.com/tscircuit/pcb-spice-pipeline.git: true
  esbuild: true
```

For local tarballs, enable the exact `pcb-spice-pipeline@file:...` entry emitted by pnpm instead.

Native solvers are downloaded and built separately using `toolchain-lock.json`. `--setup --install-deps` installs system prerequisites. Use `--tools-dir /tmp/pcb-spice-tools` and `PCB_SPICE_TOOLS=/tmp/pcb-spice-tools/tools.json` when the project path contains spaces: upstream wxWidgets makefiles do not support those build paths. `PCB_SPICE_CACHE` chooses the per-project cache. No solver results are reused.

Committed development dependencies retain the released core baseline; saved Circuit JSON stackups work with it. Generating construction from `fabricatorPreset` requires [merged core #4826](https://github.com/tscircuit/core/pull/4826). Consumers must select a verified build containing that merge until an npm release includes it, together with its compatible props version. The converter is pinned to a [prepared archive of a Git snapshot](https://github.com/tscircuit/ibis-to-spice/pull/1) containing its JavaScript and bundled NodeNext declarations. Its package test verifies that these artifacts match a clean source build. This avoids Bun running dependency preparation concurrently with the pipeline's build. The GitHub API archive URL installs the committed artifacts without converter lifecycle scripts. No converter build approval, sibling mutation or downstream builder is needed.

## Circuit JSON stackup

Physical construction comes exclusively from the Circuit JSON `pcb_stackup` and its referenced `pcb_board`. With a core version supporting board presets (see [core #4826](https://github.com/tscircuit/core/pull/4826)):

```tsx
import { ImportedBoard } from 'pcb-spice-pipeline/tsx'

// For an ordinary board:
<board layers={4} thickness="1.6mm" fabricatorPreset="jlcpcb_standard" material="fr4">{/* ... */}</board>

// For an existing routed board:
<ImportedBoard circuitJson={routedBoard} fabricatorPreset="jlcpcb_standard" material="fr4">
  {/* ibismodel, analog.transientsimulation, analog.digitalstimulus,
      voltageprobe and analog.eyediagram declarations */}
</ImportedBoard>
```

Use the existing `fabricatorPreset` values `jlcpcb_economy`, `jlcpcb_standard`, `jlcpcb_economy_20260912` or `jlcpcb_standard_20260912`, together with board `layers`, `thickness` and `material` (`fr4`, `fr1` or `flex`). For example, standard / 4 layers / 1.6 mm / fr4 resolves JLC04161H-3313. ImportedBoard forwards `fabricatorPreset` and `material`, reads layers/thickness from the saved board, and remaps the generated stackup to its saved board ID. An existing saved `pcb_stackup` takes precedence and is preserved. A preset must resolve the requested construction to produce a stackup.

Layer thicknesses are ordered top to bottom. Copper z is in mm, positive up, with zero at the upper face of bottom copper; soldermask does not shift this frame. JLC04161H-3313 yields bottom −0.035…0, inner2 0.0994…0.1146, inner1 1.3796…1.3948, top 1.4942…1.5292. The values come from [the sourced fabrication stackup](https://raw.githubusercontent.com/tscircuit/am3352-sbc/837245bceb6ac898fd5451507d6b2b8024095fe7/design/fabrication-stackup.json).

Each copper layer's conductivity is used in its FastHenry primitives and DC-resistance checks; omitted conductivity defaults to 5.8e7 S/m. Via and artificial return-strip conductivity use that default. Dielectric z ranges and relative permittivities are retained in `geometry.json`. The native decks use a homogeneous dielectric approximation: routed-copper defaults to the thickness-weighted mean of all dielectric εr values and requires all values to be known. `modeling.relativePermittivity` can explicitly override that approximation. Straightened-stage profiles retain their explicitly assumed effective εr (including the historical strip model). Neither reduction solves layered dielectric interfaces, dielectric loss or roughness.

Remove `modeling.stackup`, `modeling.conductivitySm` and board-construction `copperLayers`; these obsolete side-file construction fields are rejected. Missing Circuit JSON construction fails before extraction with:

```text
Board pcb_board_0 has no pcb_stackup. Set fabricatorPreset (e.g. "jlcpcb_standard") on <board>/<ImportedBoard> so the JLC stackup template is resolved into Circuit JSON.
```

## Modeling and simulation

Export a default TSX board (or a `circuitJson` array) plus `modeling`. Native declarations select vendor components, per-pin output/input states, arbitrary bit streams, probes and gated eye measurements. Circuit JSON times use milliseconds. Vendor IBIS assets resolve relative to the entry project or via their declared URL, with optional expected SHA-256 hashes.

`modeling.ddrAssessments` optionally binds an existing ground-referenced DQ probe/eye to a differential received DQS probe. Each entry supplies `name`, `dataProbe`, `strobeProbe`, `direction`, `sampleOffsetSeconds`, `vrefV`, `thresholds` (`vilAcV`, `vilDcV`, `vihDcV`, `vihAcV`), `setupSeconds`, `holdSeconds`, `minimumStrobeDifferentialV`, and `maximumStrobeIntervalErrorSeconds`. Optional `experimentNames` selects experiments; otherwise all are assessed. Voltages are relative to the DQ probe ground and times are seconds.

Received DQS crossings center complete two-UI DQ windows. AC setup/DC hold margins use recorded adaptive samples and linear interpolation. Quiet or ambiguous strobes and incomplete captures remain `not-evaluated`; the report exposes limits, per-edge timing and CSVs. Limits without characterization are `illustrative`. Optional characterization identifies source, receiver, speed grade, conditions, derating and `referencePlane: "receiver-pad"`; this evidence is user-supplied. No timing defaults or DDR compliance claims are inferred. The original stimulus-clock folds remain available when no assessment is configured. Public types and standalone analysis helpers are exported from the package.

`modeling` selects one to three physical lanes, explicit source/receiver ports, extraction settings and a reduction:

- `straightened-stages`: preserves routed stage lengths, widths and layer/via transitions. Profiles declare assumed signal spacing, finite artificial return-strip dimensions/position and effective permittivity. This is the historical AM3352 strip model.
- `routed-copper`: preserves original XY traces and extracts the connected `is_ground` net's actual BREP pours/cutouts plus driver/receiver ground leads. Requires `channelReference`, `extraction.groundMeshMm`, and an unambiguous receiver reference (or `groundReturn`).

The saved AM3352 routed-copper example currently hits a pre-existing FastHenry 3.0.1 numerical failure. The former in-repo pipeline and this stackup pipeline emit identical geometry (including all 16,388 segments, three ground-pour meshes, layer heights and thicknesses); the only deck difference is explicit default conductivity. No zero-length segments or swapped inner layers were found. Two 10.469 µm rounded-route edges, 100 µm wide and 1.7175 mm apart on inner1, suffice to trigger `Huh?  filament not expected length` in the solver's `1e-13` relative projected-length check. This is floating-point conditioning, not a zero-length node or a ground-plane z mismatch. Reproduce with the already installed binary:

```sh
mkdir -p /tmp/pcbsim/fh-short-bars
cp tests/fixtures/fasthenry-short-bars.inp /tmp/pcbsim/fh-short-bars/channel.inp
(cd /tmp/pcbsim/fh-short-bars && /tmp/pcbsim/tools/fasthenry-build/bin/fasthenry -p seg channel.inp)
```

Removing explicit width directions, rounding coordinates, translating to a local frame and trial 1 µm route simplification did not yield a clean full-network solve. A translated binary-grid trial also emitted `uh oh, segs don't seem parallel`; those diagnostics now reject even an exit-zero run. The raw geometry is preserved. Resolving this requires a numerically stable native mutual-inductance implementation or a separately validated route approximation; the pinned tools have not been rebuilt or bypassed. No routed DDR eye result is claimed. Historical straightened-stage strip results describe a different model.

Via plating may come from `pcb_stackup.plated_hole_copper_thickness` or explicit `modeling.viaPlatingMm`; `viaEquivalentWidthMm` and `omitThroughViaStubs` document the reduction. Supply and passive component scope remain explicit. Full mutual R/L/C terms survive in the SPICE network. Each experiment runs one native process for all probes/eyes; eyes fold recorded adaptive samples with complete windows only.

The [single-ended](examples/single-ended/index.circuit.tsx) and [differential](examples/differential-data/index.circuit.tsx) examples are current standalone fixtures. Their two-layer Circuit JSON stackups are explicit synthetic test assumptions. Fetch the exact vendor asset named in `examples/vendor-models.lock.json` into the project root's `models/` folder before running (this repository's root for these examples). The former Oct-14 examples, copied source-board tree, vendored packages, Python setup/plotting and stale saved verification outputs were removed because they depended on the obsolete experimental package/API. The saved AM3352 board remains a geometry regression fixture; its full DDR example is maintained in [am3352-ddr-eye](https://github.com/0hmX/am3352-ddr-eye).

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm test:native
```
