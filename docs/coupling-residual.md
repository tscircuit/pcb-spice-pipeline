# Residual coupling: three bounded checks

The corrected 2D model still fails the fine-openEMS comparison. These checks
do not justify a solver correction. They test three hypotheses separately,
without fitting constants, combining candidates, or running new openEMS solves.

`tests/support/coupling-residual.test.tsx` renders the existing `ReturnAgreement`
TSX fixture. It preserves the original 30 ohm drivers, 5 pF loads, 300 ps edges,
100 MHz channel R, and measured first-pulse window through 7.499 ns. Outer lines
switch together; the middle line is quiet. Native solves run serially with
`OMP_NUM_THREADS=1`, a shared exclusive lock, a process admission scan, and a
10-second per-process limit. The completed reproduction took about 11 seconds
for 24 captures, including TSX rendering and TypeScript field extraction.

Errors below are model minus fine reference in mV. Quiet peaks use maximum
absolute voltage over the full first pulse; minimum uses the signed driven
minimum. Gates are 1% of the corresponding reference magnitude plus 1 mV.
Every row still fails all four columns' gates.

| Variant | Tight far peak | Short driven minimum | Short near peak | Short far peak |
|---|---:|---:|---:|---:|
| Gate magnitude | 7.103 | 3.004 | 2.187 | 1.901 |
| Corrected baseline | -12.983 | -3.565 | -2.702 | -3.319 |
| H1: finite posts, 8 subdivisions | -12.575 | -3.568 | -2.629 | -3.269 |
| H1: finite posts, 16 subdivisions | -12.570 | -3.568 | -2.628 | -3.268 |
| H2: separate terminal blocks, 16 sections | -13.030 | -3.524 | -2.732 | -3.330 |
| H2: separate terminal blocks, 64 sections | -13.076 | -3.512 | -2.846 | -3.333 |
| H3: 24 panels, extent 24 | -12.895 | -3.538 | -2.775 | -3.288 |
| H3: 48 panels, extent 24 | -12.872 | -3.536 | -2.794 | -3.280 |
| H3: 48 panels, extent 48 | -12.872 | -3.541 | -2.795 | -3.280 |

H1 averages the existing analytic image-post mutual kernel over the actual
0.15 by 0.075 mm rectangular port cross-section, assuming uniform current.
Self L and the horizontal-end subtraction stay fixed. Adjacent mutual increases
by 1.310 pH (tight) and 0.0806 pH (short). Doubling quadrature changes any extremum
by at most 0.0053 mV. The tight far error improves by only 0.414 mV and the short
far error by 0.050 mV; the short driven minimum worsens. This approximation
cannot explain the gate deficit and does not validate the actual post-current
distribution or a complete terminal model.

H2 moves both terminal L matrices outside the line shunt capacitors, retaining
the same mutual signs and total L. Refining the line to 64 sections does not
recover the quiet peaks. The tight near error also worsens from -5.883 to
-6.790 mV, exceeding its 6.268 mV gate. Terminal placement/discretization is
insufficient to explain the residual.

H3 independently increases transverse panel resolution (12, 24, 48) and then
the dielectric-interface extent (24 to 48). At 48 panels, doubling extent changes
the tight/short far errors by -0.00037/+0.00021 mV. Increasing panels from 24 to
48 at fixed extent changes those errors by +0.02290/+0.00768 mV. Transverse
resolution does not account for the missing coupling in this experiment.

The budget ends here. Finite electric end fields, port-field distributions,
and finite-plane effects remain unresolved; none is established as the cause.
Observed openEMS mesh sensitivity also remains a limit of the reference.
The test passes by reproducing the rejection, not by qualifying the solver.

## Reproduction

Keep the research record outside this solver stack. Its local branch is
`research/si-2d-evidence` at `febb914d59032fc6bfdcde6ff986a57dacc40867`.
The referee JSON SHA-256 is
`581e8b81e408d335adbc5d0237b7c3ac6cb61883a1b23995de52fcb43a8ad231`.
With the stack's signal-aware workspace dependencies and ngspice installed:

```sh
git show research/si-2d-evidence:docs/openems-referee-data.json > /tmp/si-coupling-referee.json
OMP_NUM_THREADS=1 SI_COUPLING_REFEREE=/tmp/si-coupling-referee.json NGSPICE_BIN=ngspice \
  node --import tsx --test --test-concurrency=1 tests/support/coupling-residual.test.tsx
```

The test requires both environment variables and otherwise skips. It writes
decks, waveforms and numeric comparisons to ignored `runs/coupling-residual/`.
No board JSON, vendor model, Python, or reference-evidence JSON is added to Git.
