# 2D extraction implementation report

Working increment: the single-ended TI SN74LVC1G04 example propagates switching data through the new
2D extraction and native ngspice. This is a local implementation in progress, not a completed accuracy
or speed qualification. No branches have been pushed and no PRs opened.

The reproduction branch is `si-2d/repro` at `8a85951c6cd6b1ebd76c8dca3ea8e89d585446a9`.
Its two fast TSX tests pass and demonstrate the old lane-order geometry error and invented 2 mm return.
Its opt-in 3D baseline harness is retained on that branch only. The fix is stacked on it as `si-2d/fix`.

## First native increment

| Measurement | Before, existing straightened 3D extraction | New 2D extraction |
|---|---:|---:|
| single-ended extraction | 37.898 s | 42.802 s |
| differential-data extraction | 10.058 s | Pending |
| single-ended native ngspice | Not separately measured in baseline | 27.957 s |
| single-ended 2D segments / ladder cells | N/A | 13 / 14 |

Before extraction measurements were made in this task on the reproduction branch, using the installed
FastHenry and FasterCap. The new extraction launches neither. The measured new run was CPU-contended
with other independent processes on this Mac; it still fails the seconds-level extraction target.
There are no process timeouts, mesh attempt caps or lane/cell clamps.

The original single-ended example had no ground copper crossing some slices around a bend. The updated
TSX adds a real bottom ground pour at x=-18..18, y=-5..0.3 mm, avoiding the routed power copper. This is
an explicit example construction change, not an inferred return strip. The before reduction ignored
pours and used its declared 0.35 mm return, so this must be considered when comparing the new eye.

The native run used the lockfile-pinned real TI IBIS bytes, with package omission as in the original
example. Receiver voltage range was -0.909..4.806 V and transmitter -0.168..3.488 V. These are waveform
ranges, **not eye-opening measurements**. Eye-height/width comparison is pending an independent estimator.
An earlier completed native attempt had disconnected endpoints and a constant receiver; that was
rejected as verification. Duplicate TSX route endpoint vertices are now bound to the same junction.
A subsequent behavioral-source netlist failed transient convergence. The working netlist uses linear
E/F/H transformer formulations and positive-real R/L/RC branches.

## Verification so far

- Native verified: original baseline extraction for the two existing examples; active single-ended
  new path with one ngspice invocation and no 3D invocation.
- Unit verified: Hammerstad–Jensen single microstrip Z0 and effective permittivity within 2%; explicit
  TI via-formula worked example; nonnegative Foster fitting; every active C/C0 entry's refinement;
  real TSX lane-order invariance, real copper segmentation and named missing-data errors.
- Mesh convergence uses Galerkin panel averaging and second-order Richardson capacitance estimates;
  both raw and extrapolated entry-wise residuals are logged. It does **not** claim that the raw mesh
  residual or the surface-loss matrix has met 0.5%. That remaining qualification is explicit.
- Pending: other examples on native ngspice, stripline and coupled-line 2% accuracy, all-matrix loss
  convergence, fresh RS-485 comparison with 4.2 nH, native supply package validation, deterministic
  second native runs, NEXT/FEXT, complete eye/timing tables and final line counts.
- The multilayer TSX currently raises `via_antipad`: the native board records contain no physical
  circular antipad diameter. A split-plane edge is insufficient to infer one. No dimension is guessed.
- Known model limits: local quasi-TEM excludes radiation/bend fringing; oblique conductors contribute
  electrostatically as neutral cross-section conductors; distributed magnetic coupling is between
  parallel co-propagating pieces. Declared ideal DC rails are AC equipotential; their physical copper
  participates as reference surfaces. Distributed ground leads / supply-rail impedance is not solved.

## Checks

`pnpm build` passed after the switch. The full `pnpm test` migration is in progress: obsolete 3D deck
and reduction goldens are being replaced with physical TSX and matrix/native contracts; later results
will supersede this paragraph. Focused tests: 20/21 initially (one obsolete fixture, since migrated),
then all 17 new diagnostic checks and all 5 TSX geometry/reproduction checks passed.

See [docs/2d-extraction.md](docs/2d-extraction.md) and `src/kernel/numerics.ts` for the method and policy.

## Subsequent working increment

The four closed-form configurations now pass the 2% thresholds: isolated and edge-coupled
microstrip and stripline (including both mode impedances and mutual L/C). Independent native AC
checks pass for full R/L/K/C matrices, Foster skin loss, general positive-definite dielectric loss,
and twelve lanes. `pnpm test:native` most recently passed five tests, with one vendor-only test
skipped; separate real-TI CLI runs are recorded independently. Native supply-pin package verification also passes on the synthetic input-model fixture; the real TI package run is pending.

The latest single-ended run extracted in 12.596 s, simulated in 17.428 s, total 31.050 s. A small
IEEE-double WebAssembly LU kernel and allocation-free panel evaluation replace the slow JavaScript
elimination. Source and a rebuild script are included; no native extraction process runs. Other
board timings remain pending. These measurements supersede the first-increment timing above.

All board geometry and construction now come from TSX, including `pcbStackup`. Four pnpm patches
remove obsolete controls and lane caps from props/Circuit JSON/core serialization and expose physical
stackup construction in JSX. The fourth removes the converter’s 100000-bit and 64-MiB input caps;
only representability errors remain. No geometry records are assembled by hand. This is a local dependency
patch pending equivalent upstream releases; no `bun patch` was used.

The multilayer TSX is now a four-layer board with actual circular antipad voids in its inner ground
pour. The via diameter is measured from those voids. Etched internal-layer dielectric fill is explicit;
missing fill properties have named diagnostics. The earlier `via_antipad` limitation above is superseded.
The expanded real-board native runs are still being validated. General dielectric shunts use an exact
passive transformer congruence because material sensitivity need not have Maxwell pairwise signs.

The full unit suite passes 234/234 after updating the pinned registry for the new backend/storage diagnostics. `pnpm build`, lint and type checks pass. Mesh qualification still applies to C/C0 estimates;
all-matrix convergence and final eye/NEXT/FEXT/timing tables remain outstanding.

The first full real-TI RS-485 run now completes on native ngspice: extraction 603.187 s,
ngspice 684.055 s, total 1288.844 s, 134 segments. It fails both speed targets. The naive
unsigned matrix-entry sum is 1.476879 nH; a signed selected-route mutual-L comparison is still
pending and this number must not be equated to the 4.2-nH 3D reference. The native twelve-lane,
frequency-dependent multiport and supply-package checks pass. Full unit suite: 234/234.
