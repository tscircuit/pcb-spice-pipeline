# Opt-in copper surface mesher

The prebuilt `mesh_bg.wasm` and generated `mesh.js` use Spade **2.15.1** and
wasm-bindgen **0.2.129**. The bridge and pinned dependency graph are in `rust/`.
No compiler, native addon, download, install script or runtime build is needed.
Only the quality path initializes WASM, synchronously once per process/worker.
The loader deliberately addresses `../src/vendor/spade/` from both `src/` and
`dist/`; the npm package already includes `src`. Keep those assets together.
This helper targets Node, not browser bundlers.

## Integration

Existing `fasterCapDeck`/extraction calls retain earcut. To opt in explicitly at
the copper deck boundary (the package currently has no public geometry export):

```ts
import { copperFasterCapDeck } from './src/copper.js' // ./dist/copper.js after build

const files = copperFasterCapDeck(cell, {
  maxPanelLengthMm: extraction.maxPanelLengthMm,
  minAngleDeg: 15,       // target, not a guaranteed minimum
  maxAreaMm2: 0.5,
  maxVertices: 300000,   // total per polygon, not just Spade's added vertices
  // maxPanels: 600000,  // cap + side triangles per conductor; defaults to 2 * maxVertices
})
```

`surfacePanels(solids, name, options)` accepts the same optional third argument.
`qualityMesh(cleanUnclosedRings, options)` exposes points, triangle indices,
measured minimum angle and count below the target. It does not edit input rings.
Finite positive edge/area limits, numerically resolvable angles in (0,30], total
cap vertex budgets between 3 and 1000000, and panel budgets between 1 and 2000000
are accepted. `maxPanels` limits the entire `surfacePanels` result (one conductor),
including every cap and side triangle; it defaults to twice `maxVertices`.
Standalone `qualityMesh` also enforces this panel limit. Invalid geometry, conflicting constraints,
incomplete refinement, failed audits or budget exhaustion throw `quality_mesh:`
errors without an earcut fallback. A WASM runtime trap disables further calls in
that worker/process; restart it before retrying.

Spade refines constrained triangles with outer faces/holes excluded. Afterwards,
shared-midpoint red/green subdivision independently enforces the edge bound:
an area limit alone cannot constrain long, thin triangles. This extra pass can
change angles; inspect the returned measurements when evaluating another case.
Output checks cover finite/nonzero triangles, area/length bounds, oriented
manifold edges, every original boundary segment/vertex, holes, and total area.
Normals, original slab z levels, and cleaned copper boundaries are preserved.

The same opt-in now subdivides each original vertical rectangle and emits two
outward-wound T panels per cell. Its rectangle aspect limit is
`cot(minAngleDeg)` (3.7320508075688776 at 15 degrees), giving right triangles
with the requested side angle. Both axes receive a length budget of
`maxPanelLengthMm / sqrt(2)`, so the **triangle diagonal** also meets the limit.
The grid also enforces `maxAreaMm2`, splitting either horizontal or vertical
axes as needed. Actual emitted coordinates are audited for positive area,
minimum side angle, diagonal length and parent area preservation. Overflow,
coordinate precision collapse and exhausted panel budgets throw; no partial
deck is returned. The grid streams triangles without allocating a large vertex
array. Every positive fine face is retained, including faces below native
solver area thresholds; a threshold must never silently remove copper.

**Superseded opt-in assurance:** the previous cap-only implementation retained
all side Q bytes. The new opt-in changes their panelization while preserving
the same geometric surfaces and normals. **Default calls still retain the exact
original deck/Q bytes.** Side grid vertices add intermediate z levels within the
same slabs, without moving their upper/lower boundaries.

## Validation limits

Keep this opt-in until native electrical validation. No claim of FasterCap
convergence, physical matrices, reciprocity or electrical accuracy is made.
Research on the saved DDR case found 48 angles below 15 degrees: 22 at acute
original corners, 2 at other original vertices and 24 at inserted vertices.
They are **not all proven unavoidable**. The original research (before the new
independent edge-bound pass) preserved 42 polygons, 786 holes and 45529 side
quads; 6072 triangles below 1 degree became zero. See the repository's
`runs/mesh-research/REPRODUCE.txt` for those geometry-only measurements.

**T-junctions still remain:** cap Steiner points and the new side grid are
independent; side grids across adjoining edges/slabs can also differ. Cap
triangles conform to each other, but this is not a conforming indexed 3D
surface. Geometric closure does not establish shared indexed connectivity.
A solver requiring matching vertices needs coordinated cap/side/slab splitting
and separate validation. Side angle bounds do not establish a global minimum
angle: acute cap corners and cap refinement limitations remain.

Focused checks from the repository root:

```sh
node --import tsx --test tests/quality-mesh.test.ts tests/copper.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc -p tests/tsconfig.json
```

Prior cap-only evidence (2026-10-22): all 17 focused tests and both typechecks
passed. Original default deck bytes were checked against the pre-change source.
The local geometry-only replay and independent Shapely audit are retained at
`runs/quality-mesh-validation/replay.mjs` and `validation.json`: 42 polygons,
786 holes, 173685 T, unchanged 45529 Q, zero angles below 1 degree, 48 below
15 degrees, minimum 3.862222 degrees, maximum edge 1.569598 mm. All 17 planar
groups retained their component/hole topology; maximum surface symmetric
difference was 1.3713e-15 mm² and boundary Hausdorff distance 1.5889e-14 mm.
`runs/quality-mesh-validation/package-check.mjs` builds into temporary staging,
packs with lifecycle scripts disabled, and tests extracted `dist/quality-mesh.js`
in a clean consumer with no node_modules. It passed, including repeated sync
calls and all 32 vendor assets. Staging excludes all unrelated native scripts
and patches; this is an asset-resolution check, not approval to publish the
full working checkout. These local evidence files are not npm assets.

The side-extension round passes 20 focused tests and both typechecks. Tests
cover box/hole/via/slab geometry, outward winding, independent projected side
coverage/overlap, closure with collinear T-junctions resolved for the audit,
rotation/translation, both grid axes, true triangle diagonals, fine faces,
panel budgets, overflow/precision failure, determinism and default golden bytes.
Geometry-only product replay and independent Shapely audit commands:

```sh
node --import tsx runs/cap-side-quality/product-replay.mjs
runs/full-ddr/venv/bin/python runs/cap-side-quality/audit-product.py
node runs/cap-side-quality/package-check.mjs
```

The generated deck and evidence are in `runs/cap-side-quality/product-sides/`.
All 45529 original side rectangles become 250790 T panels, with minimum side
angle 15.001045 degrees, maximum side diagonal 0.516684 mm (2 mm requested),
minimum side area 9.8529e-12 mm² and maximum relative parent-area error
4.17e-16. The 173688 product cap T rows are byte-identical to a temporary
cap-only control using the previous side-emission branch. The earlier saved
research replay has 173685 cap T rows: its rings were recovered from triangle
unions and ordered differently, so it is not a product byte baseline. Its
surface/topology remains the independent geometric comparison. The earlier
ratio-4 prototype at `runs/cap-side-quality/spade-sides/` is historical evidence;
ratio 4 produces 14.036-degree triangles and does not satisfy a 15-degree side
target. No native full-solver run was started in this implementation round.

The independent audit retained all 17 cap groups, 42 polygon components and
786 holes. Maximum side symmetric difference was 1.56e-17 mm², overlap
2.78e-17 mm² and boundary Hausdorff distance 2.14e-14 mm; maximum cap symmetric
difference was 3.01e-19 mm². The complete surface still has 48 cap angles below
15 degrees and a minimum angle of 3.862222 degrees. These geometry checks
provide no electrical convergence or solver-connectivity guarantee. The clean
package check also passed again with 32 vendor assets and no installed consumer
dependencies, exercising both compiled cap WASM and side subdivision.

## Release rebuild (maintainers only)

The shipped research artifact was compiled with rustc
`1.98.1 (48a229cea 2026-09-01)`, target `wasm32-unknown-unknown`, release profile
`opt-level=s`, LTO, abort-on-panic, stripped. Preserve the exact pinned versions:
Spade can change refinement behavior even in patch releases.

With that Rust toolchain, the WASM target, and wasm-bindgen-cli 0.2.129 installed:

```sh
cd src/vendor/spade
shasum -a 256 -c SHA256SUMS
cargo build --manifest-path rust/Cargo.toml --target wasm32-unknown-unknown --release --locked
wasm-bindgen rust/target/wasm32-unknown-unknown/release/ddr_mesh_research.wasm --target web --out-name mesh --out-dir /tmp/pcb-spade-rebuilt
shasum -a 256 /tmp/pcb-spade-rebuilt/mesh_bg.wasm
```

The supplied WASM SHA-256 is
`1050a1917de40048729d40f2fa9707124a55e70bf58cd2b0fdb44d7f5aac38d3`.
`SHA256SUMS` covers the glue, types, WASM, bridge, lockfile and notices.
Only copy reviewed generated outputs back; rerun geometry/packaging checks and
regenerate hashes when intentionally changing a release artifact. `rust/target` is excluded from Git and npm packages when rebuilding here.

The bridge is MIT licensed under `LICENSE-MIT`. `NOTICE` and `licenses/` retain
permissive third-party notices, selecting MIT where dual MIT/Apache licensing
is offered, plus Zlib and Unicode-3.0 where required. No Triangle code/assets
are included. Do not publish unrelated native FastHenry patches: their separate
redistribution restrictions are not changed by these permissive WASM assets.
