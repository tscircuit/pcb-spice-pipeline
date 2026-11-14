# FastHenry full-plane refinement

This is the historical R/L mesh investigation, before the RFC adopted grounded
signal-block capacitance. Its primitive-C rejections and 600-second runner bound
are superseded by [the current per-level evidence](native-signal-levels.md).

The reproduction commit is `a13ffe4`: the actual `escape-via-plane.tsx` board
keeps the same two footprints and routed signal while increasing pour area 16×.
The old refined deck grows from 4,617 to 66,288 plane edges. Its regression
requires fewer than 3× as many edges and verifies that the full pour corner
remains in the deck. The final counts are 2,377 → 2,897 edges for the same 16×
area increase. Copper is not cropped to a return strip.

The first bounded candidate kept a two-height fine corridor and the former
plane thickness subdivisions. It reduced Level 3 refinement from 98,078 to
66,112 deck filaments (127,641 to 81,690 internal filaments), but still reached
the unchanged 600-second process deadline. The final candidate below also
sizes plane thickness by its allowed physical edge-filament size.

FastHenry's explicit rectangular grid now uses the requested `groundMeshMm`
within one signal/ground-lead height of each projected segment, including
vertical via segments. Outside that corridor, the target spacing increases by
0.5 mm per mm of distance. Distance uses a conservative box-to-segment lower
bound, including trace width. Finite contact areas and cutout boundaries retain
their existing local refinement; shared grid edges retain summed width shares.
The refined solve halves the requested spacing and tightens path filaments as
before. Plane edge filaments resolve half the model-frequency skin depth;
requested refinement 3→7 halves that allowed edge size. Electrically thin planes
therefore need just one thickness filament. Trace/lead filament rules are unchanged.

The geometry and cross sections are independent of sweep frequency: one native
deck covers the coarse sweep, and one covers model-frequency refinement. A
regression verifies that only the `.freq` line differs between a sweep and a
single-frequency request. No per-frequency plane remeshing is introduced.

Native evidence is recorded in
[`fasthenry-plane-mesh.json`](../tests/evidence/signal-levels/fasthenry-plane-mesh.json).
It distinguishes deck filaments from FastHenry's internal multipole refinement.
Wall times are request-archive to stdout-archive intervals, including file
staging/collection; solver CPU times are FastHenry's reported `Total`. Baselines
use the original executions, not their later byte-identical cache replays.
After cases ran concurrently and some coarse runs overlapped repository checks;
these are observed wall times, not controlled performance benchmarks. Any
byte-identical capacitance replay is explicitly identified in `native_calls`.

## Native results

**All four R/L component extractions pass the unchanged mesh, DC-R,
reciprocity and passivity checks. Whole channels were rejected by the then-used primitive-C check.**
The Level 3 refined process finishes in 580.437 seconds, leaving only about
20 seconds below the unchanged deadline; this is an observed completion, not
a guarantee of that runtime on other machines or under other loads.

Wall seconds below are before → after. Filaments are the refined deck counts,
before FastHenry's internal multipole refinement.

| Case | Coarse wall s | Refined wall s | Refined deck filaments | R mesh delta | L mesh delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Level 1 single | 26.148 → 85.986 | 102.998 → 93.638 | 52,725 → 23,367 | 1.294340% | 0.000371% |
| Level 1 differential | 8.158 → 6.258 | 159.826 → 17.863 | 62,678 → 5,134 | 0.050401% | 0.025067% |
| Level 2 | 52.627 → 121.889 | 423.112 → 109.184 | 52,615 → 27,066 | 1.338420% | 0.158812% |
| Level 3 TRAFFIC | 129.688 → 234.437 | 600, timed out → 580.437 | 98,078 → 45,870 | 1.328839% | 0.100275% |

Level 3 refined plane edges decrease 8,689 → 4,819; total internal filaments
decrease 127,641 → 61,792. Refined native CPU time is 564.26 seconds. Its
refined loop L′ values are 0.933538, 0.931926 and 0.923172 µH/m. Full R/L
matrices, both meshes, request/output hashes and all four cases' internal
counts/CPU times are in the JSON evidence.

Compared with the previous **converged refined** Level 1/2 matrices, the
largest full-matrix changes are 0.061410% R and 0.185327% L. Level 3 has no
previous accepted refinement to compare against. The maximum independent
signal DC-R residual is 0.000253%, against the unchanged 0.2% limit. Signal
and reference-path deck bytes match the baseline in both meshes; only plane
mesh/thickness subdivisions change.

Level 3 then rejects the unchanged capacitance deck at **7.008036% primitive
reciprocity error**, against 2.5%, despite a 0.549289% automatic refinement
residual. Its capacitance call is fresh native execution; the Level 1/2 C
requests replay byte-identical native outputs from the first candidate and
retain their same rejections. No C matrix is accepted or adjusted. Per the
requested stopping condition, TRAFFIC has no transient, XTALK_LOW/HIGH are
not run, and waveforms and transient convergence deltas are unavailable.

Verification: `npm test` reports 233 tests, 231 pass, two optional skips and no
failures. `typecheck`, `lint`, `check:modules` and `check:vocabulary` pass; lint
retains the existing mesh file-length warning and vocabulary is 88.9%.

Files changed: `src/extraction/{mesh,decks}.ts`,
`src/board/geometry/routed.ts` (approximation text),
`tests/extraction/{mesh.test.ts,decks.test.mjs}`,
`tests/fixtures/escape-via-plane.tsx`, this report and its JSON evidence.

## Reproduction commands

Use the same local dependency overlays and private vendor models as
[`native-signal-levels.md`](native-signal-levels.md). No vendor bytes are included
in the evidence. Each process keeps the existing 600-second bound:

```sh
export IBIS_MODEL_DIR=models
export SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js"
export TSX_TSCONFIG_PATH=examples/tsconfig.json
export NGSPICE_BIN=/opt/homebrew/bin/ngspice
export SI_NATIVE_TIMEOUT_MS=600000
export SI_RUN_ROOT=runs/graded-v2
SI_BLOCK=TRAFFIC node --import tsx scripts/run-signal-levels.tsx three
node --import tsx scripts/run-signal-levels.tsx single
node --import tsx scripts/run-signal-levels.tsx differential
node --import tsx scripts/run-signal-levels.tsx two
```

The R/L mesh tolerance remains 5%, the independent signal DC-R tolerance 0.2%,
FasterCap automatic refinement 2%, and the then-used primitive reciprocity 2.5%. Rejected
capacitance cannot enter a transient. The capacitance/dielectric implementation
is unchanged by this work.
