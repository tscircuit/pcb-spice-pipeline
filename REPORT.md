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
