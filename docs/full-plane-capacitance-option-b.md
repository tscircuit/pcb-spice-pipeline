# Full-plane capacitance, experiment B

This investigation keeps the complete primitive Maxwell matrix, charge-neutral reduction, 2% automatic capacitance criterion and 2.5% primitive reciprocity criterion unchanged. It tests whether resolving charge across the full ground plane and dielectric perimeter makes the matrix acceptable. No matrix is averaged, symmetrized, fitted or rescaled beyond the existing millimetres-to-farads conversion.

The owning repository is `tscircuit/signal-integrity-pipeline`, branch `wip/si-cap-b`, starting at `1eacbdd`. All work is local to this worktree. The reproduction remains the actual `tests/fixtures/layered-microstrip.tsx`, rendered through real core: a 40 mm × 0.15 mm trace, 1.43 mm FR-4 at er=4.42, 0.03 mm copper, and the finite 50 × 14 mm board with an unbroken bottom pour.

## Protocol

`scripts/check-full-plane-capacitance.tsx` retains each complete request, deck, stdout and stderr under ignored `runs/`. It runs FasterCap 6.0.7 with `OMP_NUM_THREADS=1` and a **600 s per-process deadline**. This diagnostic limit does not change the pipeline or example runner defaults. Times below measure the native process, including output collection; deck generation is outside this timer. This is a shared machine, not an isolated performance benchmark.

Uniform cases lower the existing `maxPanelLengthMm` everywhere, rather than subdividing dielectric panels alone. The signal sizing floor stays at half trace width. Perimeter cases bisect longest triangle edges with outward winding preserved, using `min(0.715 mm, minimum + 0.5 × XY distance to perimeter)` on return and dielectric surfaces; quads are first triangulated. The `edge-003` control grades the board outline only. `plane-edge-*` additionally grades the actual inset pour rings, including corners. Physical copper and dielectric volumes are unchanged. An independent integration of the baseline and board-perimeter decks finds maximum per-file relative area change 2.23e-12, oriented-area change 1.59e-10 mm² and oriented-volume change 6.43e-10 mm³ across all ten surface files.

`-i` requests detailed timing/memory output. `-g` selects Galerkin. Automatic and manual control choices are recorded verbatim; no claim is made that automatic mode honors every manual option. The installed CLI and logs explicitly distinguish these modes. Manual runs cannot satisfy the pipeline's automatic-refinement gate on their own.

Input panel counts include both C and D surfaces; final counts come from FasterCap's last reported refinement. The raw grounded diagonal C′ is a plausibility diagnostic, **not an accepted charge-neutral C′**. Hammerstad/Jensen predicts 37.565933 pF/m for a zero-thickness microstrip with an infinite plane. Finite ends, finite board edges, copper thickness and numerical errors remain mixed in these comparisons.

## Minimal-fixture evidence

| Case | Input panels (C / D) | Final panels | Native seconds | Reciprocity | Raw grounded C′ pF/m | Difference from H/J |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 11,700 / 9,606 | 316,518 | 6.793 | 13.3505% | 38.0300 | +1.235% |
| Uniform maximum 0.715 mm | 24,664 / 15,886 | 160,347 | 1.400 | 16.6536% | 38.3215 | +2.011% |
| Uniform maximum 0.3575 mm | 74,168 / 39,430 | 583,522 | 7.260 | 15.7648% | 37.2065 | −0.957% |
| Uniform maximum 0.17875 mm | 271,770 / 140,428 | 1,210,122 | 16.210 | 16.4871% | 38.5645 | +2.658% |
| Board perimeter minimum 0.03 mm | 47,144 / 1,307,856 | 3,269,906 | 137.348 | 8.0496% | 38.1520 | +1.560% |
| Baseline plus Galerkin | 11,700 / 9,606 | 316,518 | 57.908 | 13.5456% | 39.3273 | +4.689% |

Additional bounded cases are pending. Full raw matrices, request hashes and acceptance failures will be retained in `tests/evidence/signal-levels/full-plane-capacitance-option-b.json`.

The board-perimeter case changes the trace-excited mutual coefficient by +2.61%, the plane-excited mutual coefficient by +17.21%, and the plane self coefficient by +2.96%. This supports sensitivity of the plane-excited solution to dielectric perimeter resolution; it does not establish convergence or isolate the plane's free-space charge as the cause.

## Real-board capacitance diagnostics

These are fresh C-only native solves from the unchanged actual TSX examples through real core and `prepareBlocks`, not complete R/L/C or transient runs. This sweep overlaps the stricter minimal-fixture solver-control run; wall times include that shared load. All fresh baseline matrices exactly reproduce the recorded failures. The uniform maximum is 0.3575 mm, one eighth of the original 2.86 mm panel maximum.

| Board / mesh | Input panels | Final panels | Native seconds | Reciprocity | Raw grounded C′ pF/m |
| --- | ---: | ---: | ---: | ---: | --- |
| Level 1 single-ended, baseline | 18,769 | 179,534 | 9.567 | 10.7039% | 37.9586 |
| Level 1 single-ended, uniform | 65,754 | 264,460 | 40.985 | 13.3695% | 38.0276 |
| Level 1 differential, baseline | 73,869 | 523,553 | 29.928 | 9.4996% | 47.9444, 47.5995 |
| Level 1 differential, uniform | 141,667 | 464,491 | 143.263 | 11.6433% | 47.1193, 46.7845 |
| Level 2, baseline | 28,568 | 175,471 | 5.204 | 9.6753% | 37.7022, 37.5077 |
| Level 2, uniform | 72,704 | 274,422 | 22.671 | 11.1155% | 38.8442, 38.7830 |

The isolated-microstrip estimate is not a per-leg accuracy target for the close differential pair and its fanout. The single-ended raw diagonal remains near Hammerstad/Jensen even as reciprocity worsens. No rejected matrix enters charge-neutral reduction or a transient. Accepted L′/C′, eyes, NEXT/FEXT and timestep/section convergence deltas are unavailable for this experiment. Native R/L was not rerun; prior component results in `native-signal-levels.md` are historical evidence. Level 3 is out of scope.

## Reproduction

```sh
export IBIS_MODEL_DIR=models
export SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js"
export TSX_TSCONFIG_PATH=examples/tsconfig.json
export NGSPICE_BIN=/opt/homebrew/bin/ngspice
SI_RUN_ROOT=runs/cap-b-uniform SI_CAP_VARIANTS=baseline,uniform-0715,uniform-03575,uniform-017875 node --import tsx scripts/check-full-plane-capacitance.tsx
SI_RUN_ROOT=runs/cap-b-controls SI_CAP_VARIANTS=edge-003,galerkin,accuracy-0005,direct-001,air,air-uniform-017875 node --import tsx scripts/check-full-plane-capacitance.tsx
```

## Verification

`npm test`: 235 tests, 231 pass, four optional skips, zero failures. `npm run typecheck`, `npm run lint`, `npm run check:modules` and `npm run check:vocabulary` pass with the documented local overlays. Lint retains the existing 523-line `mesh.ts` warning; vocabulary is 88.9%. The new diagnostic script also passes an explicit strict TypeScript check and ESLint. Unit-test success does not accept any rejected native matrix.
