# Native signal API evidence

**No full-plane RFC-board channel is accepted.** Ground-plane rendering and the differential autorouter workaround now work, and native R/L refinement passes for Levels 1 and 2. Layered capacitance still fails the unchanged primitive-matrix reciprocity criterion; Level 3 refinement reaches its bounded deadline. No rejected extraction is used for a transient. Eyes, NEXT/FEXT and timestep/section convergence deltas are unavailable for every RFC case, never zero.

Earlier strip-fixture eyes and FEXT figures retained in Git history at `f79e808` remain superseded and were not reused.

The RFC examples are illustrative; these are the boards the pipeline runs. The five unchanged TSX files (including `parts.tsx`) currently match RFC `a235ddd1ba93de1245ab07f3497511a860c81345`. `level1-differential.tsx` differs: explicit pair/tap paths, explicit GND vias, `routeRemaining={false}`, a rotated 0603 termination and ideal model rails without power copper. The RFC repository, core, capacity-autorouter, props and circuit-json were not edited. The DDR3 string key and all RFC `unbroken` pour fixes are included without suppressions.

`tests/evidence/signal-levels/rfc-boards.json` records native request hashes, source/model/schema/core hashes, binary hashes, geometry-derived lengths, raw rejected matrices, component convergence and explicit null measurements. The real-core bundle hash is `67c7f6649d84798bad16b93159478cd671685f93c3919191de3d43d44148167a`. Its JLC stackup declares 0.018 mm plating, 0.03 mm outer copper, 1.43 mm FR-4 and er=4.42. Ignored `runs/` retains exact native decks and logs; vendor bytes and dependency overlays are never committed.

## Current bounded native outcomes

L′ below is the refined native loop diagonal divided by actual routed length; Level 3 has **coarse-only, unaccepted** L′. The C column is the **raw primitive diagonal** divided by length, with physical ground and infinity held at zero. It is a plausibility diagnostic from a rejected matrix, **not accepted charge-neutral channel C′**. No invalid primitive C matrix is symmetrized or reduced to manufacture a channel.

| Case | R mesh delta | L mesh delta | L′ µH/m | Raw grounded C diagonal pF/m | Outcome |
| --- | ---: | ---: | --- | --- | --- |
| Level 1 single-ended | 1.339% | 0.1227% | 0.88855 | 37.959 | C reciprocity rejected |
| Level 1 differential | 0.05626% | 0.1673% | 0.83633, 0.83833 | 47.944, 47.6 | C reciprocity rejected |
| Level 2 two signals | 1.392% | 0.1566% | 0.89623, 0.92157 | 37.702, 37.508 | C reciprocity rejected |
| Level 3 TRAFFIC | unavailable | unavailable | 0.93367, 0.93207, 0.92339 | unavailable, unavailable, unavailable | refinement timeout |
| Level 3 XTALK_LOW | unavailable | unavailable | 0.93367, 0.93207, 0.92339 | unavailable, unavailable, unavailable | shared refinement timeout |
| Level 3 XTALK_HIGH | unavailable | unavailable | 0.93367, 0.93207, 0.92339 | unavailable, unavailable, unavailable | shared refinement timeout |

Level 1 single-ended has 4 traces / 2 vias / 1 full pour; differential has 6 / 2 / 1; Level 2 has 9 / 4 / 1; Level 3 has 14 / 6 / 1. Single-ended, differential and Level 2 reject C reciprocity at 0.1070386498482376, 0.0949961368297065 and 0.09675331594056424, against **0.025**. FasterCap auto residuals of 1.724%, 1.796% and 1.371% do not override that failure.

The first single/Level 2 sweep attempts used 180 s process deadlines and stopped at the unused frequency above modelHz. The mesh fix now stops that sweep at modelHz. Subsequent Level 2 and differential runs use bounded 600 s processes. Level 3's first refined solve stopped at 180 s; one further refined attempt stopped at **600 s**, after replaying its byte-identical completed coarse request. Its refined request hash is `03d3b7b7ed4b597251ed532390e7b68f7280bab666547180013461086e3a32d3`.

XTALK_LOW and XTALK_HIGH were separately rendered and admitted without changing copper, traffic seeds or source intent. Each replayed the exact completed coarse native extraction. Their refined requests matched that same hash; duplicate native attempts were cancelled after confirming the identity. Evidence labels them **blocked by shared extraction**, retaining their actual interrupted-attempt errors and elapsed times. They are not independent successful/refined solves. No quiet idle or transient solve ran. Level 2 declares two switching signals and no quiet victim; no extra noise block was invented.

## Mesh diagnosis and regression

The former 21.03696% R delta was dominated by cross-section resolution, not by a demonstrated lack of copper. At 100 MHz copper skin depth is about 6.61 µm. A thickness-only filament rule left a 150 µm trace with approximately 25 µm outer width filaments. An isolated check holding the plane fixed gave only 2.02% R change with 7 versus 11 width filaments.

`decks.ts` now sizes **both width and thickness** against half the skin depth for each path, including ground leads and the plane thickness. Refinement tightens those cross-sections while still halving the plane spacing. `pipeline/signals.ts` no longer independently chooses one thickness-derived count for every dimension. All convergence thresholds remain unchanged.

The real-footprint `tests/fixtures/escape-via-plane.tsx` reproduction now passes R/L: mesh 1.43→0.715 mm, requested refinement 3→7 (trace width 9→13 and height 5→9 filaments), **R delta 1.20642%**, **L delta 0.14795%**. This is accepted **component mesh convergence**, not an accepted whole channel. `scripts/check-plane-extraction.tsx` reproduces it and preserves the later C rejection. Its regression checks the real TSX geometry and emitted cross-section refinement.

## Layered capacitance candidate and its remaining blocker

The old deck surrounded every face with er=4.42. Its former unaccepted 67.8566 pF/m diagnostic (80.6% above the microstrip estimate) is superseded by the layered investigation below. The new deck uses the actual finite board outline and declared dielectric z ranges, with air outside. Copper faces are partitioned by their adjacent medium and connected with FasterCap `C ... +`; `D` interfaces omit conductor contacts rather than double-emitting coincident panels. Via/lead interfaces are split at layer boundaries. Reference points have a numerically resolvable 0.01 mm offset on the declared side. The optional straight-bar R/L reduction retains the original physical copper for layered C. Soldermask, unselected power/neighboring copper and dielectric loss remain omitted.

The deck follows the primary FasterCap [conductor](https://github.com/ediloren/FasterCap/blob/master/hlp/InputFile/3D/InputFile_3D_ch03.htm) and [dielectric](https://github.com/ediloren/FasterCap/blob/master/hlp/InputFile/3D/InputFile_3D_ch04.htm) formats. Geometry regressions verify material assignment and closed copper volumes. These tests do not establish numerical accuracy of a rejected solve.

For the minimal 28.118503 mm route, the raw grounded diagonal is **37.958635 pF/m**, versus **37.565933 pF/m** from the zero-thickness [Hammerstad/Jensen microstrip estimate](https://qucs.sourceforge.net/tech/node75.html): a **+1.045%** plausibility difference. Native loop L′ is **0.900588 µH/m**, versus **0.866916 µH/m** analytically. The estimate assumes an infinite plane and excludes finite-board edges, bends, end leads, vias, copper thickness and internal inductance; their individual residual contributions were not isolated. Differential diagonals additionally include close pair coupling and substantial receiver fanout, so isolated-microstrip C is not an accuracy target for each leg.

**That C matrix remains rejected at 10.704% primitive reciprocity error.** Its 1.724% automatic refinement figure is insufficient evidence. Bounded Galerkin / tighter-GMRES diagnostics remained nonreciprocal; a current-deck `-a0.005` attempt and a stringent manual solve reached their 180 s deadlines. No further parameter search was made after those bounded checks; final default-setting calls only refreshed evidence for the committed deck. No coefficient or waveform was fitted, rescaled, or accepted to force agreement. An earlier diagnostic value of 36.03 pF/m reduced an invalid primitive matrix; it has been removed as an extracted C′ result. Accepted charge-neutral C′ remains unavailable.

## Bounded microstrip reciprocity reproduction (PR #62 follow-up)

**The requested capacitance fix is unresolved. No production deck/mesh change survived this investigation.** The new `tests/fixtures/layered-microstrip.tsx` supplies a straight 40 mm × 0.15 mm top trace and an optional second trace at 0.75 mm pitch over a real unbroken bottom pour. Real core supplies the 50 × 14 mm board, 1.43 mm FR-4 (er=4.42) and 0.03 mm copper. Both reference pads are on bottom; there are no bends or vias. This rules out trace bends and via/lead surfaces as necessary causes of the failure, but does not isolate the defect in the layered deck or mesher.

Reproduction commit `2c43ab8` adds two opt-in native regression tests, both **failing** at the unchanged 0.025 primitive reciprocity limit. Default tests skip these two solver checks. A separate deterministic test now verifies that D panels plus reversed FR-4-contact C faces enclose the declared FR-4 volume, have zero net oriented area, and place every `D ... -` reference on the intended side. All six D-face directions are present. Every D-panel centroid avoids the copper contact polygons at the same z; independent polygon intersections of all 9,558 horizontal D panels with touching copper find zero positive-area overlaps on a 1e-8 mm grid; trace undersides and plane tops use er=4.42, and all other C faces use air. Across exactly shared C/D input edges, the maximum ratio of panel longest-edge sizes is 3.742× in the baseline and 1.697× in the edge-graded candidate (partial T-junction edges are excluded from this statistic). The graded candidate still fails reciprocity at 12.127%. These geometric checks pass; they do not establish numerical accuracy.

`scripts/check-layered-capacitance.tsx` uniformly subdivides only dielectric panels, holding copper, physical geometry, native arguments and acceptance criteria fixed. Each original triangle becomes four per refinement; quadrilaterals are first triangulated. Native matrices and request hashes are in `tests/evidence/signal-levels/layered-capacitance-investigation.json`; exact requests/logs remain in ignored `runs/`.

| Fixture | Interface refinement | D panels | Primitive reciprocity | Auto residual |
| --- | ---: | ---: | ---: | ---: |
| Single | 0 | 9,606 | 13.3505% | 1.25243% |
| Single | 1 | 38,616 | 13.3003% | 1.25071% |
| Single | 2 | 154,464 | 13.8204% | 0.813949% |
| Coupled | 0 | 14,416 | 9.85126% | 0.99034% |
| Coupled | 1 | 57,856 | 10.4418% | 1.21801% |
| Coupled | 2 | 231,424 | 9.75350% | 1.73641% |

Uniform interface refinement alone therefore does not resolve reciprocity. Additional bounded checks also failed: fourfold return-only / signal-only / both-conductor refinement gave 16.8627% / 13.9526% / 17.2715%; grading both meshes by copper-edge distance and thickness gave 12.1266% single / 11.2403% coupled; matching XY-projected sizing gave 16.3538% / 10.6607%. The two sizing candidates were reverted. Reversing material-specific C file order and equivalent per-panel inward/outward reference conventions reproduced the original matrix exactly. Splitting D files into 2 mm XY tiles gave 16.7017%. An all-air, no-interface control gave 0.177171%, but represents a different physical problem and cannot replace FR-4.

Manual `-t0.000001` in auto mode reproduced the original output; this does not prove auto mode honored that manual option. `-d0.1` gave 12.0053%; a single `-d0.01` attempt stopped at its 90 s deadline. These were diagnostics only; production solver arguments and all tolerances remain unchanged. No output was fitted, rescaled, symmetrized or reduced to bypass primitive acceptance.

The single fixture's **rejected raw grounded diagonal** is 38.030 pF/m versus the same zero-thickness Hammerstad/Jensen 37.565933 pF/m estimate (+1.235%). This close diagonal agreement cannot validate its nonreciprocal matrix. Finite ends/board edges, 30 µm copper and numerical error remain mixed; their residual contributions were not isolated. Accepted charge-neutral C′ and its requested few-percent analytic validation remain unavailable.

Fresh, uncached Level 1 single/differential and Level 2 native attempts use `runs/cap-review-final/` and 600 s per-process limits. All three fresh uncached attempts completed native R/L and then reproduced the original C reciprocity errors exactly: 10.703865%, 9.499614% and 9.675332%, in 414.717 / 306.247 / 672.726 s total. The per-process limit is 600 s, not a whole-case limit. A supplementary Level 2 run replayed only byte-identical earlier R/L and freshly recomputed the same rejected C in 4.017 s; it is labelled separately in the investigation evidence. The collector points to the three new uncached attempts; Level 3's retained evidence belongs to the earlier investigation and is outside this capacitance task. No FastHenry source, other worktree, RFC or sibling repository was edited.

Reproduce the bounded sweep and the intentionally failing native regressions:

```sh
SI_RUN_ROOT=runs/layered-capacitance SI_INTERFACE_REFINEMENT=0,1,2 node --import tsx scripts/check-layered-capacitance.tsx
SI_TEST_NATIVE_CAPACITANCE=1 node --import tsx --test tests/extraction/dielectric.test.ts
SI_RUN_ROOT=runs/cap-review-final SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx single
SI_RUN_ROOT=runs/cap-review-final SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx differential
SI_RUN_ROOT=runs/cap-review-final SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx two
```

Use the overlay/native environment below. The next useful increment requires isolating why the otherwise closed, correctly sided layered surfaces produce nonreciprocal charge; the present evidence does not justify a deck fix or a transient run.

## Differential layout and internal receiver taps

The manual example is rendered through real core with `routeRemaining={false}`: all pair/tap paths and GND leads are preplaced and no copper/courtyard/dangling-path errors remain. Actual soic8 pads are TX A/B=(-22.85, ∓0.635) mm and RX A/B=(22.15, ∓0.635) mm. The 0603 is at (23.8, 0), rotated 90°; its pads are (23.8, ∓0.825) mm. The 0.15 mm trunks have 0.25 mm pitch, then fan around RX on opposite sides. Model POWER/GND rails remain ideal; physical power copper is omitted explicitly.

A pipeline limitation surfaced after routing: two contiguous traces could not share the RX port. The pipeline now joins degree-two copper paths into one native conductor, preserving the RX pin as an internal tap at its actual arc-length fraction. Uniform pi sections split at each tap so receiver loading is not moved to RTERM. Native totals are preserved; independent section refinement retains the same physical tap positions. Branches and cycles remain explicit errors. Real-footprint TSX and netlist regressions cover this behavior.

The unchanged `tests/fixtures/differential-termination.tsx` remains the minimal autorouter reproduction. The exact upstream throw is capacity-autorouter 0.0.1054, `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts:1005`; its root/net-name match at :997 associates multiple final paths with a trunk. Core source construction is `lib/utils/autorouting/getSimpleRouteJsonFromCircuitJson.ts:603`; pair selection is `getDifferentialPairsForSimpleRouteJson.ts:205`. No upstream repository was edited. Differential **routing** is no longer blocked; native simulation stops at the shared C numerical boundary above.

## DDR3 boundary and pictures

Independent source preflight with `routeRemaining={false}` returns exactly, from both real core and pipeline:

```text
.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.
```

The native solver callback count is zero. The image command additionally attempts the unchanged full DDR3 board through real core for at most 180 s; the current attempt produces only placed pads, no routed traces/vias/pour, and is labelled **partial**. It is not a completed DDR layout or simulation.

`examples/levels/README.md` embeds five 1600 px PNGs. `scripts/render-example-images.tsx` imports the actual TSX and renders core again at image-generation time, showing top/bottom copper without silkscreen. Current lower panels contain exact committed blocking messages; quiet panels identify the shared failed request. There are no accepted waveforms to commit or draw. The runner can archive compact adaptive samples only after accepted runs, with full-resolution hashes and measurements; the image code folds them over 2 UI after the gate and supports idle-relative signed quiet plots. Those successful-output drawing paths have no accepted RFC data to exercise yet.

## Verification and reproduction

Final local verification: **235 tests, 231 pass, 4 optional skips, 0 failures**; source/test/example typechecks and explicit script typechecks pass. Lint passes with the existing mesh-length warning (now 523 lines). Module checks pass; vocabulary is 88.9%. All five final PNGs were opened and visually inspected. These are local overlay checks, not accepted RFC simulation results or proof that published-dependency CI is ready.

Local checks use ignored sibling overlays and local vendor models. Export the same JSX configuration for tests and scripts:

```sh
export IBIS_MODEL_DIR=models
export SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js"
export TSX_TSCONFIG_PATH=examples/tsconfig.json
export NGSPICE_BIN=/opt/homebrew/bin/ngspice
npm test
npm run typecheck
npm run lint
npm run check:modules
npm run check:vocabulary
node --import tsx scripts/check-plane-extraction.tsx
node --import tsx scripts/check-ddr3.tsx
SI_RUN_ROOT=runs/rfc-native SI_NATIVE_TIMEOUT_MS=600000 node --import tsx scripts/run-signal-levels.tsx
SI_BLOCK=XTALK_LOW SI_RUN_ROOT=runs/rfc-low node --import tsx scripts/run-signal-levels.tsx three
SI_BLOCK=XTALK_HIGH SI_RUN_ROOT=runs/rfc-high node --import tsx scripts/run-signal-levels.tsx three
node --import tsx scripts/render-example-images.tsx
```

`SI_EXTRACTION_CACHE` can point to a prior case directory; only byte-identical complete native requests are replayed and labelled. Omit it for fresh native extraction. The collector script's explicit run-directory list records this bounded investigation and can be updated after new native runs. The final native commands currently reject extraction; success of unit tests does not accept their matrices or establish hardware/BER/protocol compliance. Published dependencies still lack the unpublished shared SI records; local overlay checks do not imply CI readiness.

The numerical criteria are unchanged: R/L mesh 5%, FasterCap auto 2%, primitive reciprocity 2.5%, and independent transient timestep/section RMS plus signed-extrema checks at 1% + 1 mV. No RFC case reaches transient convergence. `pdn="ideal"` keeps ideal die rails and vendor signal-pin package R/L/C; extracted PDN and coupled packages retain their documented boundaries. Upstream KU/KD is unchanged.
