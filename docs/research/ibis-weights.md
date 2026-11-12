# IBIS switching-weight research

The candidate reduces derivative-grid sensitivity and improves the measured
fixture reconstruction of the selected buffers. It remains an opt-in research
path. Full-board probe differences reach 14.958 mV; the bounded DDR result below
does not establish a practical complete DDR simulation.

This spike is stacked on `fix/routed-ddr3-level4` (329a32c, PR #75).
The production path is unchanged. `convertPackaged` accepts an optional fourth
research argument `{ windowSeconds, coefficientTolerance }`. No pipeline caller
supplies it. A voltage qualification is required before enabling it generally.

`weight-fit.ts` solves the same two-fixture KCL as the pinned converter. It replaces
nonuniform three-point differentiation on the union of independently sampled V-T
tables with each fixture's exact average PWL derivative over a stated time window.
It samples the solution on a uniform half-window grid and reduces both weight
columns together. The reduction has a continuous absolute coefficient error bound
of `coefficientTolerance` relative to that sampled PWL. This bound does **not**
cover the derivative averaging or imply a bound on arbitrary loaded outputs.
For each fixture i, using the converter's into-pad current convention:

`Ipu(Vi) KU + Ipd(Vi) KD = (Vfixture_i - Vi)/Ri - C_comp dVi/dt - Ipc(Vi) - Igc(Vi)`.

The two same-direction loads provide the two rows of this linear system. The
secant `(V(t+h/2)-V(t-h/2))/h` is the exact average derivative of the fixture's
PWL voltage over that window (one-sided at the endpoints). After solving, each
accepted reduction chord differs by at most epsilon at every original grid knot
in both columns. The difference of two PWL functions is linear between knots,
so the same bound holds continuously on every segment.

Negative, greater-than-one and nonmonotone coefficients are retained. Near-singular
fixtures are rejected at a dimensionless determinant threshold corresponding to a
condition number of about one million; the spike does not invent missing fixture
information through a prior.

```mermaid
flowchart LR
  tables[Two same-direction V-T fixtures and one corner] --> derivative[Average each PWL derivative over explicit window]
  derivative --> solve[Reject ill-conditioned systems; solve two-fixture KCL]
  solve --> reduce[Reduce both coefficients with stated absolute PWL bound]
  reduce --> replay[Replay each original fixture in locked bounded ngspice]
  replay --> compare[Compare V-T error and actual board probe differences]
```

## Native fixture qualification

The sweep covers 14 output models, three selected corners and both edge directions:
84 extraction cases, 168 native decks and 336 individual fixture waveform replays.
Each deck reconstructs both original resistive fixtures independently without a
package. All requested native fixture runs completed. Each family's typical loads
are: inverter 50 ohms to 0/3.3 V; bus P/N 27 ohms to 0/3.3 V; rpin 50 ohms to
0/3.3 V; AM335x 50 ohms to 1.5/0 V. Each edge has two same-direction fixtures.

Windows are 20 ps for the inverter and rpin, 1 ns for bus P/N, and 10 ps for all
AM335x models. Every reduction tolerance is 0.001. The following voltage maxima
cover both edge directions and both loads, separately for typ/min/max. They are
observed bounds against the PWL IBIS tables, with the C_comp corner qualification
below. Values are rounded to 0.001 mV. They are not general guarantees for arbitrary loads or continuous-time
transistor behavior.

| Model | κ₂ max (all corners) | Typical rising/falling knots before → after | Peak fixture mV, typ / min / max (before → after) |
|---|---:|---|---|
| LVC1G04_OUT_33 | 10.034 | 177→160 / 171→163 | 5.576→2.636 / 5.658→1.052 / 25.249→10.807 |
| a_b_p | 5.972 | 197→49 / 198→66 | 9.136→2.271 / 3.283→1.730 / 14.909→2.982 |
| a_b_n | 5.972 | 197→49 / 198→66 | 9.128→2.271 / 3.272→1.727 / 14.888→2.953 |
| rpin | 5.060 | 194→54 / 191→61 | 4.933→2.630 / 3.560→2.114 / 5.929→5.543 |
| Model_257 | 2.659 | 194→135 / 189→141 | 4.006→1.722 / 6.423→1.303 / 12.086→1.888 |
| Model_579 | 2.658 | 193→103 / 193→101 | 2.701→1.332 / 2.617→1.203 / 11.045→1.830 |
| Model_771 | 2.658 | 193→103 / 193→101 | 2.701→1.332 / 2.617→1.203 / 11.045→1.830 |
| Model_336 | 2.658 | 190→84 / 193→94 | 2.772→1.345 / 4.319→1.146 / 15.411→1.857 |
| Model_655 | 2.830 | 193→94 / 193→88 | 2.955→1.920 / 4.178→1.235 / 20.950→2.246 |
| Model_847 | 2.830 | 193→94 / 193→88 | 2.955→1.920 / 4.178→1.235 / 20.950→2.246 |
| Model_352 | 2.623 | 196→92 / 197→83 | 4.797→1.364 / 2.761→1.228 / 15.547→1.985 |
| Model_345 | 2.415 | 197→96 / 195→88 | 2.129→1.348 / 3.039→1.206 / 16.006→1.643 |
| Model_273 | 2.623 | 193→127 / 192→131 | 3.525→1.126 / 4.124→1.171 / 10.309→2.288 |
| Model_343 | 2.830 | 193→94 / 193→88 | 2.955→1.920 / 4.178→1.235 / 20.950→2.246 |

The selected Winbond `CMD`, `ODT_60` and `ODT_off` models are receivers: no KU/KD
extraction is used. The inverter input model likewise has no driver coefficients.
Plots of all 84 output cases, the KD cluster and the receiver explanation stay
in the private evidence directory.

The sampled AM335x matrices remain well conditioned (worst kappa about 2.83). In
Model_352, KD changes from about 0.519 to 0.629 in 1 ps near 244 ps while kappa
is about 2.34. The fixture's local voltage slope changes sharply, which changes
C_comp*dV/dt by milliamps. The main cause is derivative sensitivity of the PWL
data on short intervals, rather than a near-singular current matrix. The 0.1 ps
clusters exist in individual AM335x fixtures and are also introduced by their
union grid. The inverter has a 5 ps minimum union interval; bus P/N and rpin have
20 ps minima in the typical rising cases. Those buffers do not share the DDR
sub-picosecond sampling pattern.

A static ablation reduces the original Model_352 coefficients at tolerance
0.001 to 110/105 rising/falling knots, without derivative averaging. The combined
candidate has 92/83, from 196/197 originally. The native runtime experiment
combines averaging and reduction; it does not isolate the benefit of smoothing.
A preliminary typical Model_352 window tradeoff measured 2 ps at 242/216 knots,
5 ps at 152/152, 10 ps at 92/83 and 20 ps at 52/53; increasing the window trades
complexity for voltage error. Those exploratory native runs used a coarser output
step than the final all-corner sweep.

## Board comparisons

These runs start from the existing TwoTraceBoard and level1-differential TSX
sources. Geometry, packages, integration, tolerances and output policy are held
fixed. Only the explicit buffer fit differs. No independent full-board convergence
qualification or acceptable probe-difference budget is claimed.

| Case | Duration | Stored native samples before -> after | Engine wall seconds before -> after |
|---|---:|---:|---:|
| two-trace | 40 ns | 2093 -> 2069 | 0.223 -> 0.249 |
| level1-differential | 576 us | 278879 -> 160673 | 49.033 -> 18.812 |

| Probe | Peak difference mV | Time-weighted RMS difference mV |
|---|---:|---:|
| two-trace DATA_0 | 5.059 | 0.580 |
| two-trace VICTIM_0 | 3.479 | 0.492 |
| two-trace VICTIM_1 | 1.391 | 0.133 |
| level1-differential BUS_0 | 11.782 | 0.847 |
| level1-differential BUS_0_P | 14.958 | 0.839 |
| level1-differential BUS_0_N | 14.908 | 0.828 |

The differential case takes about 2.61 times less wall time. The inverter case
has essentially unchanged sample count and no measured speed benefit. These are
single-run comparisons, not isolated matrix-factorization measurements.

## Bounded DDR experiment

The saved `DDR3_ADDR_CMD` RouteNetworkInput has 24 signals: 22 Model_352 and two
Model_343 drivers with Winbond CMD receivers. Input SHA-256 is
`dd876038705dbeee3d8b9e3f79e2f8b86e4d3b14cbfc06d0c4ebf435fc2d7dc5`.
Both variants are recompiled with current #75 scheduling and the identical complete
network. The archived predecessor deck's 1 fs stitch is not used.

The first address/command edge is at 2.5 ns. A quiet-only 0-1 ns control hit the
600 s cap after writing 88 samples through 0.985597 ns, or 6.818 s per stored
sample: substantial cost exists before active switching. The quiet candidate was
cancelled while queued and never invoked ngspice.

For the active comparison, all PWL source times receive the same 2.3 ns offset,
putting the first trigger at 0.2 ns. The initial DC state, relative timing, edge
shape, package and electrical network are preserved. Each variant requests 0-1 ns
and has an independent 600 s native cap. This removes quiet lead-in without
compressing a measured edge.

| Variant | Engine wall s | Stored native samples | Last written time ns | Wall s / stored sample | Completed 1 ns |
|---|---:|---:|---:|---:|---|
| Original | 600.016 | 60 | 0.317901 | 10.000 | no; capped |
| Fitted | 600.017 | 52 | 0.364672 | 11.539 | no; capped |

Across the 48 KU/KD sources, full 8 ns schedule knot counts are 195-508, total 16336
originally and 90-239, total 7602 fitted. This saved stimulus is not the exact
991-knot pattern cited in the task. No 991-to-N comparison is claimed.
The baseline cap stops before the large KD cluster around 0.44 ns in the shifted
window. Deck SHA-256 values: original `36fc4fbf1ed02ad78c4b19bf3e9fd440e6bf40f88c11a836c619d27140a72092`;
fitted `c4c7a071d5715f9cf5e139e245f2eec485b5234b870b7144c92efff100ce1761`.

Capped counts include fully written raw samples and can miss buffered tail data.
They are a lower bound on stored samples, not the engine's internal accepted or
rejected timestep counts. Wall/sample includes parsing, DC solution and output;
it is a cost proxy, not isolated per-step linear algebra. Different covered time
intervals do not establish a complete-run speed ratio.

The fitted case also fails to complete the requested active window within ten
minutes. This is a **negative result for the claim that this weight change alone
makes this DDR deck practical**. It retains useful coefficient/fixture evidence,
but no complete DDR result or projected full-run speedup is established. Both caps
stop before the main KD spike, so its full-runtime contribution remains unmeasured.

## Corner qualification

The parser and extraction use one selected voltage column throughout I-V, V-T,
fixture voltage and C_comp. No interpolation between typ/min/max voltage columns
was found. V-T time coordinates are shared by the three columns, however: an
adaptive table can retain very short intervals important to a different corner.
Some AM335x 0.1 ps clusters already exist in a single vendor fixture; the union
of the two fixture grids adds further short intervals. Differentiating this
piecewise-linear representation makes weights sensitive to the local slope
changes even when the two current equations are well conditioned.

There is a separate legacy C_comp semantic risk. Ordinary C_comp min/max entries
are ordered by numerical capacitance, not guaranteed to represent the same PVT
corners as the I-V/V-T min/max columns. [IBIS 7.2, C Comp Corner](https://ibis.org/ver7.2/ver7_2.pdf)
provides explicitly corner-correlated values; [Intel/Mentor's discussion](https://ibis.org/email_archive/2045.html)
explains why legacy ordering alone cannot establish the correlation. The pinned
converter uses the same-named C_comp column. This spike deliberately retains that
policy for a controlled comparison; its min/max replay results qualify that
**declared selection**, not a physically proven capacitance/process association.
There is no C_comp corner ambiguity in the typical comparisons. Upstream should
make this policy explicit before claiming general PVT fidelity.

## Sources and interpretation

- [IBIS 8.0 specification](https://ibis.org/ver8.0/ver8_0.pdf), Rising/Falling
  Waveform: up to 1000 rows, increasing time, complete initial/final DC states,
  time correlation between fixtures of the same direction. The specification
  defines the data format; it does not mandate a particular simulator extraction
  or smoothing algorithm.
- [IBIS Modeling Cookbook](https://ibis.org/cookbook/cookbook-v4.pdf), §§3.2.2–3.2.3:
  the normal push-pull recommendation is rising **and** falling into both GND and
  VCC resistive fixtures, package/reactive fixture terms removed, C_comp retained,
  common input reference time, settled endpoints. Versions through 3.2 allow 100
  points; version 4.0 increases this to 1000. §5.3 discusses concentrating points
  where curves change. The point count is a ceiling, not a minimum simulator step.
- [Giacotto/Muranyi, Intel, 2003](https://ibis.org/summits/jun03a/muranyi1.pdf),
  pp.5–8: two equations/two unknowns, including C_comp*dV/dt. The same KU/KD
  across loads is a modeling assumption, rather than an exact transistor identity.
- [Ross, 2004](https://ibis.org/email_archive/0716.html): equal or unsuitable
  fixtures can make the equations singular; EDA vendors use different protection.
  Prefer independently informative GND/VCC fixtures. This is primary historical
  commentary, not a disclosure of current proprietary tool internals.
- [Chen, Synopsys, 2008](https://ibis.org/summits/nov08a/chen.pdf): constrained
  single-waveform extraction is possible only with extra assumptions and is
  compared across loads; it does not establish KU+KD=1 for two-waveform data.
- [Chen, Synopsys, 2016](https://ibis.org/summits/nov16a/chen.pdf): proper reactive
  fixture/DUT de-embedding can make coefficients noisier while improving replay.
  This argues against cosmetic monotonicity/clipping without voltage validation.
- [Wang et al., 2011](https://www.ibis.org/users_archive/3238.html): commercial
  implementations differ in interpolation, endpoint extension and smoothing;
  automatic correction can itself cause incorrect results.

Condition-aware least squares/SVD, regularization and monotonic constraints are
reasonable numerical candidates, but I found no primary public source establishing
one universal commercial recipe or a spec requirement for such processing.
For more than two informative fixtures, a residual-qualified joint fit is sensible;
for rank deficiency, rejection is preferable to silently claiming a unique answer.
This spike addresses derivative sensitivity in well-conditioned equations.

[Bindel, Cornell, 2025](https://www.cs.cornell.edu/courses/cs6241/2025sp/lec/2025-01-28.html)
explains rank-revealing QR/SVD and Tikhonov's bias/stability tradeoff as general
numerical background. It is not documentation of an IBIS vendor's implementation.

## Reproduction and validation

Run `scripts/research-ibis-weights.tsx fixtures`, `boards`, or `ddr` with
`IBIS_MODEL_DIR`, `SI_IBIS_EVIDENCE` (a private scratch directory), and
`SI_NGSPICE_LOCK` (the supplied machine-wide lock script). DDR additionally needs
`SI_DDR_NETWORK_INPUT`, the private saved RouteNetworkSolver constructor input.
Every native invocation runs `research-ibis-native.mjs` under the shared lock.
Caps are 60 s per fixture, 120 s per small board, and 600 s per DDR variant.
The engine is native ngspice 47 with KLU and OMP_NUM_THREADS=1; lock waiting is
excluded from engine timings. All native evidence is local and vendor-derived.
No vendor tables, vendor plots or board JSON are committed.

Fixtures select one corner consistently for I-V, V-T, fixture voltage and C_comp,
retain clamps and capacitance, and use each waveform's own R_fixture/V_fixture.
The maximum error is evaluated over the union of native times and original V-T
knots: it is the exact maximum of the two PWL representations. RMS integrates
the squared linear difference analytically. Native discretization error is a
separate limitation. The fixture step is no larger than window/10 or edge/10000.

The vendor-free regression uses actual TSX source with independently sampled
fixture grids. It demonstrates the derivative spike, checks rejection and corner
selection, and checks continuous coefficient-reduction error. Scheduler regression
checks unchanged default behavior and explicit experimental provenance.

Local lint, module boundaries, vocabulary and typechecks pass; the research script
also passes a separate strict typecheck. The locked full suite passes: 279 passed,
37 skipped, zero failed, including the synthetic native switching oracle. The
existing mesh.ts file-size warning remains. Typechecks use the required local
RFC circuit-json/props/core builds; no dependency changes are committed.

## Recommendation and remaining risks

Keep the combined fit opt-in. Upstream the joint PWL reduction with an explicit
continuous coefficient tolerance first, then qualify derivative-window selection
against a stated voltage budget. The extraction change belongs in
`@tscircuit/ibis-to-spice` `switchingWeights` (`lib/convert.ts` at pinned ad1ec9e),
consumed by `bitWeights` in `lib/general.ts`. No node_modules files were edited.
Both variants retain #75's held edge starts, settled-tail admission and explicit
logical schedules.

A reduced fitted PWL has a proven coefficient bound; the derivative window has
only the measured fixture voltage bounds above. Both fixture tables are calibration inputs; board parity uses the baseline rather
than transistor-level truth. Held-out-load validation is unavailable.
Scheduled first-row holding and
tail admission remain separate transformations, qualified here by the board
comparisons. Arbitrary loads, supply motion, different corners, higher bit rates,
reactive fixtures and other IBIS models need their own voltage qualification.
The current spike requires zero-origin data and handles two purely resistive fixtures and rejects rank-deficient
systems. More informative fixtures should be fitted jointly with rank and residual
reporting. Clipping, monotonicity and KU+KD=1 remain unsupported priors here.

Resolve the legacy C_comp PVT policy before advertising general corner fidelity.
Separate the runtime contributions of reduction and averaging before crediting
noise removal alone. The slow quiet DDR control and the active-window cap show
that network/solver cost remains material. The parallel network-reduction tracks
must be evaluated separately before claiming the complete DDR run is solved.
