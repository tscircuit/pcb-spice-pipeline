# Native signal API evidence

The scope is the **verbatim RFC boards intended to have a full opposite-layer ground plane**, not the earlier pad/1 mm top-ground-strip fixtures. All earlier strip-fixture eyes, approximately 1.3 V FEXT, and convergence figures are **superseded**. They remain in Git history at `f79e808`; they are not measurements of the RFC boards. There are currently **no accepted full-plane RFC-board native results**.

All six files in `examples/levels/` match the RFC assets byte-for-byte at RFC head `5f4d848f91aab44b7426480e98792a99d5493bea`. `scripts/run-signal-levels.tsx` now includes Level 2 and renders directly through real core, without stripping SI elements, patching Circuit JSON, or injecting plating. The evidence uses core `ca4bb147291e8eb41dfa92b5d4c361d1dc21e9f3`, props `8b44084`, and circuit-json `bc2c8a6`. The JLC stackup declares 0.018 mm plating, 0.03 mm outer copper, 1.43 mm dielectric, and er=4.42.

## Verbatim RFC-board outcomes

A bounded render/preflight pass covers every case below. Level 3's quiet blocks were also isolated from the unchanged board without changing seeds or copper. Zero native solver calls were made: missing geometry or core rendering stopped each case before extraction. An unavailable measurement is not zero.

| Board/block | PCB traces | Vias | Pours | Outcome | Eyes, NEXT/FEXT, L/C, timestep/section deltas |
| --- | ---: | ---: | ---: | --- | --- |
| Level 1 single-ended | 3 | 0 | 0 | `ground_geometry`: no physical ground copper pours | Unavailable |
| Level 1 differential | 0 | 0 | 1 | Core differential autorouting fails; no routed BUS | Unavailable |
| Level 2 | 8 | 2 | 0 | `ground_geometry`: no physical ground copper pours | Unavailable |
| Level 3 TRAFFIC | 13 | 4 | 0 | `ground_geometry`: no physical ground copper pours | Unavailable |
| Level 3 XTALK_LOW | 13 | 4 | 0 | Same missing physical ground pour | Unavailable |
| Level 3 XTALK_HIGH | 13 | 4 | 0 | Same missing physical ground pour | Unavailable |

Level 2 declares two switching signals and no quiet victim. Even after its layout is repaired, its current RFC intent does not request a standalone quiet-victim NEXT/FEXT measurement. No quiet block was invented for these runs.

`tests/evidence/signal-levels/rfc-boards.json` records the exact example, runner, schema, vendor-model, and rendered-input hashes, core provenance, errors, and null measurement fields. Complete inputs and raw logs stay ignored under `runs/rfc-boards*`; no vendor bytes or local overlays are committed.

## Root causes and proposed upstream changes

**Ground-plane intent:** plain `<copperpour connectsTo="net.GND" layer="bottom" />` does not request ground escape routing. Core `lib/utils/autorouting/getUnbrokenCopperPourObstacles.ts:134` skips pours without `unbroken`. The single-ended board therefore routes GND between top pads without a GND via; `lib/components/normal-components/Board/Board_doInitialPcbCopperPourCleanup.ts:21` removes the floating bottom pour. Level 2/3 have signal-routing vias, not a connected ground plane.

Suggested RFC edits, **not applied**: add `unbroken` to the GND pours in `level1-single-ended.tsx:34`, `level1-differential.tsx:23`, `level2-two-signals.tsx:13`, `level3-three-signals.tsx:16`, and `level4-ddr3-write.tsx:109` (inner1). An independent single-ended diagnostic with only that prop added produces one full bottom plane and two ground escape vias. The multi-signal/DDR suggestions have not been validated. Explicit ground-via/lead connections are another way to express the required physical path.

The minimal positive source is `tests/fixtures/escape-via-plane.tsx`; remove its `unbroken` prop to reproduce the missing-plane outcome. It uses real `sot23_5` footprints and autorouting, with no IBIS or handcrafted Circuit JSON needed.

**Differential routing:** the actual RFC board and the smaller `tests/fixtures/differential-termination.tsx` both fail with `Pipeline9: differential pair connection "source_trace_…" must resolve to exactly one final point-pair connection, got 2`. Captured SRJ contains two-terminal pair trunks plus separate termination tails; the failure is downstream of that source representation. The precise upstream throw is capacity-autorouter 0.0.1054, `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts:1005` (verified from its source map). Its root/net-name match at line 997 associates multiple final paths with a selected trunk. Core's source-path construction is `lib/utils/autorouting/getSimpleRouteJsonFromCircuitJson.ts:603`; pair selection is `getDifferentialPairsForSimpleRouteJson.ts:205`. No pin-map error was demonstrated. No core, props, circuit-json, autorouter, or RFC repository was edited.

**RFC type error:** `level4-ddr3-write.tsx:101` uses `<trace key={i}>`, but props `lib/components/trace.ts:18` declares a string-only key. Suggested RFC change: `key={String(i)}`. The copied source remains verbatim, so the newly included example typecheck reports this exact error, without a suppression.

## Pipeline fix and bounded plane diagnostic

A valid unbroken plane exposed a pipeline bug: core ends an escape route at its physical via, while `groundConnection` rejected every route not ending on a wire. The stacked commits are `308df97` (failing real-footprint TSX reproduction) and `e8814f0` (fix). The pipeline now validates the associated physical barrel, electrical net, layer span, plating, and full barrel contact with the pour, then retains the native via endpoint. Missing/misnetted barrels, invalid plating, and inconsistent spans remain errors. The regression checks the actual 0.018 mm barrel cross-section and plane endpoint.

One bounded extraction of that **minimal reproduction, not an RFC example**, exercised `routed.ts`'s full pour/lead/via geometry with `/opt/homebrew/bin/{fasthenry,FasterCap}`. It did **not** produce an accepted channel: resistance changed **21.03696%** when ground mesh halved from 1.43 to 0.715 mm (filaments 3→5), exceeding the unchanged **5%** threshold. Inductance changed 1.2436%. The two FastHenry calls took 11.048 s in total; each process had a 180 s deadline. No further R/L mesh attempt was made.

One separate FasterCap diagnostic completed its automatic refinement at **1.78023%**, within its unchanged 2% tolerance. It does not override the rejected R/L mesh. The exact FastHenry requests were replayed only to generate the comparison summary; native capacitance was fresh. No transient was run on this rejected extraction.

For the 28.118503 mm signal route, the **unaccepted** native totals correspond to **L′=0.903074 µH/m**, **C′=67.856553 pF/m**. A zero-thickness Hammerstad/Jensen estimate for w=0.15 mm, h=1.43 mm, er=4.42 gives **L′=0.866916 µH/m**, **C′=37.565933 pF/m**, er-effective=2.926931, and Z0=151.911760 ohm. The equations are the [Qucs technical microstrip formulas](https://qucs.sourceforge.net/tech/node75.html), 11.4–11.18. Native L is 4.17% higher; native C is 80.63% higher. This is a plausibility comparison, not validation of the rejected model.

The native capacitance deck currently fills all space with er=4.42 (`src/extraction/decks.ts:70`), including above the trace. The corresponding homogeneous estimate is **56.728839 pF/m**; native C is still 19.62% higher. The analytic estimate omits finite-plane edges, bends, end leads, via geometry, copper thickness, and internal inductance. No coefficient, capacitance, or waveform was rescaled to force agreement. The homogeneous dielectric assumption is an accuracy limitation for a real microstrip, not a substitute for a layered dielectric solve.

`tests/evidence/signal-levels/plane-extraction.json` records the unaccepted numbers, comparison assumptions, request hashes/replay origins, geometry/input hashes, and binary hashes. `scripts/check-plane-extraction.tsx` reproduces the bounded extraction and separate capacitance diagnostic.

## DDR3 boundary

The unchanged full DDR3 board's autorouting attempt was manually interrupted after approximately four minutes; no precise elapsed time or completed layout is claimed. Its native solver call count was zero.

`scripts/check-ddr3.tsx` independently checks **source admission with `routeRemaining={false}`**, explicitly not a completed layout. Both real core and public pipeline preflight return exactly:

```text
.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.
```

The pipeline callback count is **zero**. `ddr3-boundary.json` labels this source-only check and records that full layout is unverified. There is no DDR eye or protocol-compliance claim.

## Convergence, checks, and reproduction

The production numerical criteria are unchanged: independently halve transient timestep and double sections; every probe must pass integrated RMS and signed-extrema checks at **1% + 1 mV**, across both adaptive native timestamp sets. Signed quiet noise uses a separate settled constant-drive idle solve. Disabled victims also require independent initial-charge tests. No RFC case reached those checks, so their deltas are unavailable.

`pdn="ideal"` keeps die POWER/GND on ideal rails and preserves vendor signal-pin package R/L/C. Upstream KU/KD remains unchanged. Extracted PDN, coupled packages, and branched routed graphs retain their documented explicit boundaries.

Local verification uses ignored built sibling overlays. `IBIS_MODEL_DIR=models NGSPICE_BIN=/opt/homebrew/bin/ngspice SI_CORE_MODULE=<absolute core/dist/index.js> npm test` passes **226/228 tests, two optional skips, no failures**, including the real-core escape-via regression. Unit tests retain dedicated small TSX sources with explicit ground vias and a bottom plane; they do not supply RFC native evidence. The native buffer regression uses fixed historical channel totals only to test ideal-rail section behavior.

Source and test typechecks pass. `npm run typecheck` additionally checks the verbatim RFC examples and **fails only at DDR3 line 101** for the numeric key described above. Lint passes with the existing 521-line mesh warning; module and vocabulary checks pass (89.6%). Published dependencies still lack the unpublished SI schema/props changes, so these local overlay checks do not imply CI readiness.

Run from this repository after building the supplied siblings. `SI_CORE_MODULE` selects the real built core; `TSX_TSCONFIG_PATH` enables automatic JSX for the import-free RFC sources. The runner's default native-process deadline is 180 s. No Circuit JSON adapter is used for the Level 1–3 runner.

```sh
export IBIS_MODEL_DIR=models
export SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js"
export TSX_TSCONFIG_PATH=examples/tsconfig.json
SI_RUN_ROOT=runs/rfc-boards node --import tsx scripts/run-signal-levels.tsx
SI_BLOCK=XTALK_LOW SI_RUN_ROOT=runs/rfc-boards-XTALK_LOW node --import tsx scripts/run-signal-levels.tsx three
SI_BLOCK=XTALK_HIGH SI_RUN_ROOT=runs/rfc-boards-XTALK_HIGH node --import tsx scripts/run-signal-levels.tsx three
node --import tsx scripts/check-ddr3.tsx
node --import tsx scripts/check-plane-extraction.tsx
```

The first three commands currently exit unsuccessfully with the recorded upstream/layout errors. Omit `SI_EXTRACTION_CACHE` for fresh native extraction. Failed extraction, finite synthetic eyes, and native buffer unit tests establish neither hardware accuracy nor BER/protocol compliance.
