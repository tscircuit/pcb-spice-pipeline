# Routed 2D mechanism investigation (step 4)

Owning repository: `tscircuit/signal-integrity-pipeline`, local branch
`feat/si-2d-extraction`, starting at `9faefd9`. No push, PR or merge.
**Verdict: the coupling admission bug is fixed; routed 2D remains physically
unqualified. The finite-return closure alone does not close the RFC gap.**
The stronger hybrid also fails both quiet-victim cases. These candidates do not
complete step 4's requested qualification or enable DDR3 route editing.

## Controlled agreement tests

`tests/fixtures/return-agreement.tsx` supplies actual routed TSX: 0.15 mm top
traces, a solid bottom reference, direct bottom-layer ground contacts at both
ends, no ground leads/vias, and the actual JLC two-layer 0.4 mm dielectric
(er=4.36). The nominal board thickness is not used to rescale the stackup.
This is the short-return alternative to stitching; the present 3D extractor
cannot represent a multi-contact stitched return. Broad pads are represented
by the existing inscribed contact area, not uniform end injection.
Both field models use the declared bare, lossless dielectric. To isolate fields
from switching models, these controls use identical linear 30 ohm drivers,
5 pF receivers, 300 ps edges, 20 ns captures and 16 pi sections. The middle of
three traces stays low while both outer traces switch. No vendor IBIS is used.
Each 3D R/L mesh and native C solve passes the existing extraction checks.

| Conductors / spacing mm | Length mm | Worst RMS mV | Worst signed-extremum difference mV | 1% + 1 mV |
| --- | ---: | ---: | ---: | --- |
| 1-0.3 | 10.0 | 8.154 | 18.883 | Pass |
| 3-0.3 | 10.0 | 9.353 | 17.609 | Fail quiet victim; driven probes pass |
| 3-1-short | 5.0 | 11.279 | 35.329 | Fail quiet victim; driven probes pass |

The single-ended L is 5.766 nH in 3D versus 5.611 nH in 2D (2.69% difference),
C is 0.5622 versus 0.5642 pF. At 0.3 mm spacing, 3D self L spans
5.616–5.690 nH versus 5.441–5.509 nH in 2D; C diagonals differ by up to 4.55%.
The 0.3 mm quiet-victim signed-extremum difference is 9.189 mV, exceeding
its approximately 6.9 mV limit. At 1 mm the quiet difference is 16.473 mV,
versus approximately 1.86 mV allowed. Thus strict controlled agreement was
**not** established, and a return-only attribution is ruled out.
The 1 mm control was shortened from 10 to 5 mm after its original capacitance
solve exceeded the memory guard. No extra 4 mm 3D solve was attempted; the RFC
already supplies 4 mm native evidence, with its different 1.43 mm reference gap.

## Mechanisms and the 3D reference limitation

1. **A real 2D admission bug.** The old 1 mm geometric cutoff suppresses parallel
   coupling at 4 mm. With the RFC width, thickness and 1.43 mm reference gap,
   the bare 2D solver gives normalized mutual C/L of 1.72% / 5.19% at 4 mm,
   0.261% / 1.514% at 8 mm, and 0.0578% / 0.396% at 16 mm. An 8 mm radius
   is therefore not a defensible universal cutoff either.
2. **Finite return is significant, but is not the whole gap.** The accepted
   three-channel primitive return self L is 13.118 nH, and signal–return mutuals
   are 8.28–8.37 nH. Write the symmetrized primitive matrix as `[S m; mᵀ g]`.
   Its accepted fixed-return loop matrix is `S-m1ᵀ-1mᵀ+g11ᵀ`.
   Completing the energy square separates the shorted-return block
   `S-mmᵀ/g` from the positive rank-one closure
   `g(1-m/g)(1-m/g)ᵀ`. This is an exact algebraic decomposition, independently
   checked for R and L. The closure contributes 1.715–1.783 nH per matrix
   entry; the full 3D mutual loop L is 3.488–4.602 nH. It is evidence of a
   shared-return contribution, not a measured ground-bounce waveform.
3. **Other magnetic terms remain.** In signal order D0/D1/D2, 2D ideal-reference
   self L is 21.789 / 22.686 / 22.768 nH; adjacent mutuals are 0.970 / 1.099 nH.
   Adding closure does not reconstruct the full 3D self or mutual terms. Full
   3D magnetic replacement is the independent ablation below. Finite signal
   ends, contact spreading, finite plane geometry and differing rail scope
   remain mixed in this residual; it is not attributed to one term without
   evidence.
4. **Materials and electrostatic geometry differ.** The original 2D path assumes
   a planar 20 um mask and laminate loss; the 3D reference omits them. Removing
   the assumed mask changes the isolated RFC C from 42.222 to 38.565 pF/m,
   an 8.66% reduction. Matched-material ablations explicitly use bare/lossless
   material; this is not measured laminate data, and the original default
   assumptions remain unchanged. Even then the three-channel integrated C
   diagonals are 1.090–1.119 pF versus 1.064–1.068 pF in 3D. The new 2D scope
   also retains rail copper that the accepted 3D model omits; it cannot silently
   discard that copper to obtain a better comparison.
5. **The accepted 3D result is not physical ground truth.** The rendered RFC
   board has six ground pins and six ground-access vias. The accepted extraction
   retains just two reference leads (`source_port_12`, TX2, and `source_port_17`,
   RX0), and collapses every signal onto that shared return. It is not a native
   multi-contact return/PDN extraction. No sign or energy error was found in
   `AᵀZA`; the physical two-contact admission is a material limitation. Adding
   stitching to TSX would not be an honest ablation while that extra contact
   network is ignored. A 3D multiport return model is needed to establish the
   actual board's ground bounce before treating all its crosstalk as truth.

The field method is the filament/mesh partial-inductance formulation described
by [Kamon, Tsuk and White, FastHenry](https://www.rle.mit.edu/cpg/publications/pub53.pdf)
and its [native user guide](https://www.fastfieldsolvers.com/Download/FastHenry_User_Guide.pdf).
The square completion above and the following arc projections are derived here;
these references do not assert that an ideal 2D plane plus this closure equals
an arbitrary finite return. Both return R and L are constant-frequency candidate
approximations, not a broadband PDN model.

## Implemented changes

- The 2D preparation admits whole candidate nets within a **32 mm cap**, then
  solves every parallel pair with the actual 2D solver. A pair stays coupled
  whenever `abs(Cij)/sqrt(Cii*Cjj)` **or** `abs(Lij)/sqrt(Lii*Ljj)` is at least
  **0.005**. Connected components form the final multiconductor solves.
  The ledger records both normalized values and decisions. The cap and
  same/adjacent-layer omissions carry explicit warnings; this is a local pair
  criterion, not a bound on summed waveform error. More than 40 candidate
  conductors fails before the quadratic screen. Oblique magnetic coupling
  remains omitted. The public 3D scope remains unchanged.
- `extractRouteReturn` executes only two serial FastHenry requests, including
  the original mesh convergence, native-log, port-order and passivity checks.
  It performs no 3D C solve. The closure model adds the positive R/L energy by
  a congruence of length-weighted longitudinal currents. The magnetic ablation
  instead replaces all series R/L with the full 3D loop matrices, distributed
  by overlap in normalized route arc, and omits the 2D skin branches. This is
  explicitly **3D R/L + 2D C**, not pure 2D or return-only extraction. Both are
  opt-in unqualified candidates. Joined/branched return channels fail; the full
  magnetic ablation also rejects signal vias pending transition deembedding.
- Explicit material options make comparisons reproducible; warnings record
  actual selected values. The comparison rejects physical-board, model,
  pattern, seed, endpoint or timing differences. Core's asynchronous block
  allocation can renumber opaque signal IDs; the analysis validates every
  electrical declaration and maps reference probes by signal name/receiver
  ordinal, without aligning or shifting waveforms.
- The runner preserves native usage, exact extraction request hashes and the
  native archive reuse source. All RFC magnetic requests matched accepted
  field request bytes; no 3D waveform was used to fit any model. This cache
  replay establishes model identity, not a field-extraction performance gain.

## New Part A: default routed 2D with physics-based admission

Unchanged RFC TSX, IBIS bytes, patterns and seeds; original full **7.2 us**
single-ended / **576 us** differential durations, including startup.
Metrics integrate all adaptive samples on the native union grid without shifts.
The extrema column is the larger absolute difference of the signed maximum and
minimum, across probes. Individual signed extrema, edge counts and timings are
retained in `routed-2d-step4-comparison.json`. The original mask/loss assumptions
are retained here, so this is the actual default 2D behavior after the bug fix.

| RFC case | Native 2D s | Worst RMS mV | Worst signed-extremum difference mV | 1% + 1 mV |
| --- | ---: | ---: | ---: | --- |
| single | 8.816 | 64.342 | 102.539 | Fail |
| differential | 20.338 | 0.689 | 0.024 | Pass this case |
| two | 32.778 | 111.258 | 216.228 | Fail |
| three/TRAFFIC | 68.229 | 136.012 | 358.957 | Fail |
| three/XTALK_LOW | 58.708 | 100.204 | 786.062 | Fail |
| three/XTALK_HIGH | 58.698 | 111.104 | 1014.113 | Fail |

The single-ended difference increases because the wider scope now retains rail
copper that the old 1 mm scope omitted. A wider radius is not an accuracy claim.
Quiet victims now have nonzero coupling, but the cases still fail the policy.

## Full-duration, matched-material hybrid ablations

Both columns below use the same bare/lossless declared-geometry approximation,
with the same nonlinear IBIS buffers and packages as the accepted path. Each
entry is **worst RMS / worst signed-extremum difference in mV**. The verdict
applies to the magnetic replacement column. Differential uses routed 2D alone:
its joined physical termination tail is outside the hybrid admission above.

| RFC case | 2D + shared-return closure | 3D R/L + 2D C | Magnetic hybrid verdict |
| --- | ---: | ---: | --- |
| single | 37.816 / 38.531 | 12.659 / 30.325 | Pass this case |
| differential | 0.646 / 0.022 | 0.646 / 0.022 | Pass this case |
| two | 63.916 / 92.796 | 12.259 / 31.859 | Pass this case |
| three/TRAFFIC | 87.353 / 153.989 | 11.657 / 33.542 | Pass this case |
| three/XTALK_LOW | 63.491 / 365.715 | 9.074 / 13.524 | Fail |
| three/XTALK_HIGH | 72.539 / 436.873 | 10.339 / 50.710 | Fail |

The closure alone passes single-ended and differential only. Replacing the
remaining magnetic network passes two-channel and TRAFFIC too, but **both quiet
victims still fail**. This closes much of the numerical gap without qualifying
the requested path. Separate XTALK_HIGH spatial and timestep refinements pass
numerical convergence; their metrics are retained in the mechanism evidence.
Residual electrostatic geometry/admission differences therefore remain material;
this is not evidence that all remaining error is a single capacitance term.

## Safety, reproduction and remaining work

Every native call was serial with OMP_NUM_THREADS=1. All completed calls were
well under 20 minutes; the longest RFC transient was 78.721 s. Two initial field
attempts crossed the original sampled 1 GiB guard before termination:
1,055,568 KiB (FastHenry, rejected 9/17-filament single) and 1,081,696 KiB
(FasterCap, rejected 10 mm / 1 mm-spacing control). No result from either is
accepted. The field runner now stops at **768 MiB** to leave headroom below the
1 GiB ceiling, and validates a deadline of at most 1,200 s (default 240 s).
The smaller 5 mm control completed under that stop. Exact-cache replay requires
complete outputs; interrupted C attempts are not reusable. These sampled limits
are not operating-system hard RSS limits.

With the environment in `routed-2d.md`, run commands sequentially:

```sh
node --max-old-space-size=512 --import tsx scripts/check-return-agreement.tsx
uv run --with numpy python scripts/summarize-return-agreement.py
SI_ROUTE_RUN_ROOT=runs/routed-2d/step4/part-a-full node --max-old-space-size=512 --import tsx scripts/compare-routed-levels.tsx
SI_EXTRACTION_CACHE=runs/final-rfc SI_REQUIRE_COMPLETE_CACHE=1 SI_ROUTE_RETURN=1 SI_ROUTE_MATERIALS=declared SI_ROUTE_RUN_ROOT=runs/routed-2d/step4/hybrid-full node --max-old-space-size=512 --import tsx scripts/compare-routed-levels.tsx
SI_EXTRACTION_CACHE=runs/final-rfc SI_REQUIRE_COMPLETE_CACHE=1 SI_ROUTE_RETURN=series SI_ROUTE_MATERIALS=declared SI_ROUTE_RUN_ROOT=runs/routed-2d/step4/magnetic-full node --max-old-space-size=512 --import tsx scripts/compare-routed-levels.tsx
```

For each root, invoke `summarize-routed-levels.py` with `SI_ROUTE_RUN_ROOT` and a
separate `SI_ROUTE_EVIDENCE` destination. `SI_ROUTE_REFINEMENT=2` and
`SI_ROUTE_TIME_REFINEMENT=2`, separately with `SI_BLOCK=XTALK_HIGH`, reproduce
hybrid space/time checks. Run artifacts and plots stay ignored; committed
JSON evidence contains numbers and hashes, not vendor bytes or original decks.

Remaining: model and validate the actual multi-contact 3D return, resolve finite
plane/end/rail electrostatics and remaining magnetic differences in a cheap path,
and pass every quiet-victim case plus independent numerical checks. The current
candidates do not meet that acceptance gate. No further DDR3 route-edit loop or
claim of a physically accurate system is enabled.

Validation: `pnpm lint`, `pnpm check:modules`, `pnpm check:vocabulary`,
`pnpm typecheck` and `pnpm test` pass. The suite reports 217 passed / 27 opt-in
skips, with zero failures; a separate vendor-backed TSX selection passes all 12
tests without native execution. The four TS runners also pass an explicit
TypeScript check. Lint retains only the existing 535-line `extraction/mesh.ts`
warning. The TSX coupling reproduction fails before the fix and passes after it.
