# pcb-spice-pipeline: real AM3352 DDR eye example

Executable local workflow: native tscircuit TSX → published routed PCB geometry → native FastHenry/FasterCap extraction → existing IBIS-to-SPICE converter → native ngspice → measured waveform and generated eye diagram. Runtime uses ordinary code, without an LLM.

As an installed dependency in a normal tscircuit project, use the `pcb-spice-pipeline` CLI:

```sh
pnpm exec pcb-spice-pipeline --setup
pnpm exec pcb-spice-pipeline index.circuit.tsx
pnpm exec pcb-spice-pipeline --repeat index.circuit.tsx
```

The TSX entry exports its board normally and exports `modeling` for the explicit channel/construction inputs. TSX loading is automatic. The project supplies the exact experimental core/props/converter peer packages through ordinary dependency overrides. Setup requires Python **3.11** and builds the native toolchain under the caller's `node_modules/.cache/pcb-spice-pipeline`; generated results go to fresh `dist/simulation-*` directories. `--repeat` runs two fresh solver processes and compares their outputs. The normal board project is [am3352-ddr-eye](https://github.com/0hmX/am3352-ddr-eye), with its own standard TSX entrypoint and pinned dependencies.

The remaining commands and paths below describe this implementation's **source checkout and historical verification fixtures**. Those fixtures are intentionally excluded from the installed npm package.

The runnable entry is [`examples/am3352-eye.tsx`](examples/am3352-eye.tsx). It imports the **complete published AM3352 board snapshot**, annotates its actual U1/U3 chips with vendor IBIS models, and declares a native `<eyediagram>`. It preserves saved routing rather than rerunning the historical autorouter. Field extraction then reduces the selected two DQS paths to straightened stages with explicit construction assumptions.

## Run locally

Requirements: Node.js ≥22, pnpm 11.25.0, Python ≥3.11, Git, a C/C++ compiler and network access on first setup. On macOS, install Xcode command-line tools (`xcode-select --install`) and Homebrew if absent. The setup script installs native build dependencies through Homebrew on macOS or apt on Linux. The executed proof uses native Darwin arm64 tools on this Mac; Linux CI is supplied but has not been run as part of this proof.

From this folder:

```sh
./scripts/reproduce.sh
```

This installs frozen Node dependencies, builds pinned native solvers, creates `.venv` with pinned plotting packages, runs checks, and executes the real TSX example **twice in fresh directories**. It prints the new `runs/proof-*/summary.json` path. No old extraction or simulator output is reused. Source/model download caches are hash checked.

Exact individual setup commands, when Node/pnpm are already on PATH:

```sh
pnpm install --frozen-lockfile
python3.11 scripts/setup-tools.py --install-deps
python3.11 -m venv .venv
.venv/bin/python3 -m pip install -r requirements.lock.txt
pnpm typecheck
pnpm test
pnpm test:native
```

After setup, generate one run or repeatability proof:

```sh
pnpm exec tsx src/cli.mjs examples/am3352-eye.tsx --out runs/my-ddr-eye
pnpm prove runs/my-ddr-proof
```

Both output paths must be new. `pnpm eye` uses `runs/am3352-eye`. `pnpm prove --all` also regenerates the legacy synthetic, routed JSON and small TSX examples. To audit two completed fresh runs independently:

```sh
node scripts/audit-eye.mjs runs/my-ddr-proof/am3352-eye-a runs/my-ddr-proof/am3352-eye-b
```

A source archive runs without Git; receipts then record a null local Git commit and retain the exact runtime file hashes and upstream source/model provenance.

## Native TSX syntax and actual electrical selections

The real entry uses the board's original physical ball names:

```tsx
<board
  circuitJson={routedBoard}
  routingDisabled
  schematicDisabled
  simIbisModels={{ U1: modeling.driver, U3: modeling.receiver }}
>
  <eyediagram
    name="DDR_DQS0"
    positive=".U3 > .F3"
    negative=".U3 > .G3"
    unitInterval="2.5ns"
    duration="100ns"
    timeStep="10ps"
    startTime="20ns"
  />
</board>
```

`simIbisModels` attaches the existing native `chip.ibisModel` behavior during imported-board inflation. Named targets must exist uniquely and be chips. Imported pad geometry, ball aliases and existing routes are retained. An imported board accepts simulation-only eye children; physical replacement children are rejected. The historical original TSX is preserved under `examples/source-board/` with a download/hash manifest.

`<eyediagram>` validates unit-aware times and resolves its selectors after rendering. Numeric times mean seconds. The pipeline reads its public `getEyeDiagramDescriptor()`, inserts the extracted channel, and executes ngspice. Changing its duration, probes or timing changes the executed run; it does not just label a plot. The current workflow supports one differential eye per run at either the two driver pads or the two receiver pads. Cross-endpoint probes and unrelated pins fail before field extraction. No separate ordinary `<analogsimulation>` is declared.

| Role | Published component | Signal balls | Power reference balls | Selected IBIS settings |
|---|---|---|---|---|
| Driver | U1, TI AM3352BZCZ100 | P1 DDR_DQS0; P2 DDR_DQSN0 | E5 VDDS_DDR; A1 VSS | `am335x_zcz`, Model_655/847, typical, 1.5V, slow slew, nominal 9mA, ODT off |
| Receiver | U3, Winbond W631GG6MB-12 | F3 DQSL; G3 DQSL# | A1 VDDQ; B1 VSSQ | `ODT_60`, typical, 60Ω input termination, pin R/L/C package |

The original vendor ZIP and `.ibs` bytes are fetched from TI/Winbond and SHA-256 checked against the existing converter locks. The parser/converter is reused unchanged through `@tscircuit/ibis-to-spice`. Native emitted model source and terminal mappings are checked against independent conversion and then used in the actual SPICE assembly. Driver and receiver pads have distinct electrical nodes, so ideal trace connectivity cannot bypass the extracted channel.

The selected drive/ODT settings are demonstration choices; actual firmware configuration is unknown. The stimulus is an explicit complementary 5ns-period clock, not a DDR controller/traffic simulation. TI's coupled package is explicitly excluded; Winbond's supported uncoupled signal-pin package R/L/C is included. Supply references use real ball labels but the supply itself is an ideal 1.5V source; power-distribution impedance is not extracted.

## What “pre-solved” means for this board

The pinned fixture is byte-identical to **astra/am3352-sbc v0.1.19**, registry release `a56db1f7-99bf-4f14-b32e-ab5431f039d0`. Its original TSX matches GitHub import commit `837245bceb6ac898fd5451507d6b2b8024095fe7`. Decompressed Circuit JSON SHA-256:

```text
c9d7059fe536865784f175855e0dcc76510972319eec848c18b0ef6dcd2adb40
```

This is a saved engineering checkpoint with routed DDR paths. The original source explicitly says the board is not DDR compliant or ready for fabrication. It reports 750 native traces, 11 unconnected-port errors, 21 physically disconnected nets and 47 saved DDR paths. Strict byte-lane absolute-length checks still fail. Geometry/connectivity checks are evidence of those checks; no independent silicon measurements, DDR SI sign-off or manufacturing validation were found.

Primary source: [exact checkpoint README](https://raw.githubusercontent.com/tscircuit/am3352-sbc/837245bceb6ac898fd5451507d6b2b8024095fe7/README.md), [route provenance](https://raw.githubusercontent.com/tscircuit/am3352-sbc/837245bceb6ac898fd5451507d6b2b8024095fe7/design/ddr-route-provenance.json), [board page](https://tscircuit.com/astra/am3352-sbc). Full source/version/pin evidence is in [`examples/source-provenance.json`](examples/source-provenance.json). The imported board's regenerated diagnostics are preserved separately in each run's `rendered-board.json`; successful simulation of the selected channel does not certify the surrounding board.

## Explicit board construction and model approximation

[`examples/am3352-construction.json`](examples/am3352-construction.json) declares every selected copper z range, dielectric layer, conductivity, via plating and model omission. The source's working JLC04161H-3313 construction is nominally 1.6mm: 35µm outer copper, 15.2µm inner copper, two 0.0994mm prepregs (er4.1) and a 1.265mm core (er4.42). Its calculated copper/dielectric total is 1.5642mm. This is a selected draft construction; manufacturer approval and actual manufactured properties are unavailable.

The executed extraction uses actual selected route lengths/widths and ordered top→via→inner1→via→top stages. Original meander vertices remain in `geometry.json`. The two original paths have 369/371 vertices. Their stage lengths are roughly 44.80/44.92mm plus active via lengths.

**The field solver geometry is a reduced channel:** routes are straightened within each stage, uniform equivalent signal center separation is explicitly assumed to be 0.75mm, and a finite 2mm-wide/35µm-thick return bar replaces actual reference-plane geometry. The original source's nominal 0.12mm pair edge gap and varying escape/via spacing are not reproduced by this uniform profile. The full dielectric stack is documented; the channel uses homogeneous effective er2.55 on top and er4.1 on inner/via stages.

FastHenry returns the full three-conductor complex impedance. Signal/return loop reduction preserves shared-return resistance and signed magnetic coupling. FasterCap returns a full 3D capacitance matrix; eliminating common voltage with total charge zero gives voltages relative to the finite return conductor. This represents an isolated neutral conductor group, not an infinite ideal ground plane. Full R/L/C matrices are divided into 12 coupled pi sections per stage.

R/L are fixed at 100MHz; the saved frequency spectrum is not fitted into a broadband model. Omitted effects include actual planes/cutouts/reference stitching, neighboring copper, bend/meander coupling, via pads/antipads/stubs, dielectric loss, copper roughness, package coupling and power integrity. The eye folds an alternating deterministic DQS clock after startup. It does not include random data, injected jitter/noise, BER or JEDEC compliance testing.

## Generated evidence

Each run contains:

- `eye.png`/`eye.svg` and `waveform.png`/`waveform.svg`.
- `waveform.csv`: actual adaptive ngspice time samples and driver/receiver pad/differential voltages.
- `eye-data.csv`/`eye-data.json`: folded windows interpolated from those measured samples.
- `eyediagram.json`: executed declaration, resolved ports, polarity and SPICE nodes.
- `geometry.json`, per-stage solver decks/panels, raw coarse/refined `Zc.mat`, FasterCap output/matrix CSV and extraction checks.
- `driver.lib`, `receiver.lib`, `channel.cir`, `simulation.cir`, native IBIS mapping evidence.
- Original snapshot/vendor bytes, construction/settings, command records/logs, binary hashes, upstream revisions and per-file SHA-256 receipt.

Fresh repeatability compares raw refined/coarse matrices, full netlists, generated samples/eye data, metrics and plots. Independent auditing recomputes matrix reductions and eye samples directly from raw solver/waveform outputs. This demonstrates repeatability of the declared approximation; it does not establish physical accuracy against manufactured hardware.

The native core/props are pinned **experimental local tarballs**, with readable source patches and test evidence under `vendor/native-patches/`. They have not been upstream merged or published. The converter tarball is the unchanged existing commit `4292a5a23ce6b33ade8abbd238685c1790845bb7`.

The packaged source checks passed 12 native eye/import tests (107 assertions), six existing real-vendor IBIS regressions, and both core/props source typechecks. Nine of ten requested importer compatibility tests passed; the remaining original visual snapshot differs by 0.01% on the unchanged baseline too. Its 33 structural assertions passed. Logs are preserved in `verification/native-source-regressions/`. Consumer TSX uses strict checking with the upstream `skipLibCheck` setting for dependency declaration files.

## Notices

Integration code is MIT. Original board source has no explicit detected license; its attribution and separate notice are preserved. The fixture repository's MIT notice is preserved. Manufacturer model notices remain in downloaded original files. FastHenry's original notice restricts internal noncommercial use/redistribution; it is not the permissive MIT software license. Native solver source/binaries and proprietary vendor archives are downloaded locally, not packaged in the source archive. Setup preserves original solver notices. No public repository/npm publication is performed.
