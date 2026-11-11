# openEMS referee for routed 2D extraction

Research run: 11 November 2026, Apple M5, macOS 27 arm64. Owning repository:
[`tscircuit/signal-integrity-pipeline`](https://github.com/tscircuit/signal-integrity-pipeline),
branch `feat/si-2d-extraction`, starting revision `399db6f`.

**Result: neither path is a universal full-wave reference.** In the defined
PEC/local-return controls, 3D is closer for the driven receiver in all three
cases. Tight-coupled far-end crosstalk favors 3D; wide-spaced near/far crosstalk
favors 2D. Both paths miss the far-victim peak band in both coupled cases.
Finite-conductivity copper and the RFC two-contact realization remain
unverified. This study is committed locally only.

## Scope and reference definition

The archived FastHenry/FasterCap result is a comparison model, not ground truth.
The experiment starts from the rendered
[`ReturnAgreement` TSX fixture](../tests/fixtures/return-agreement.tsx) and its
archived geometry in `runs/routed-2d/step4/controlled/`. No hand-authored Circuit
JSON is used as a reproduction. Read the preceding
[cross-section](2d-cross-section.md), [routed model](routed-2d.md),
[validation](routed-2d-validation.md), and [step-4 investigation](routed-2d-step4.md)
for the extraction assumptions.

This FDTD model has a finite board, finite rectangular reference plane and
finite-thickness PEC trace volumes. It uses local vertical circuit connections
to the plane below each trace endpoint. The archived 3D extractor instead
reduces the reference pads to **two shared radius-0.15 mm plane contacts**, one
at each end, and uses those terminals in the loop-incidence reduction. These
are different port/reference definitions. Agreement here can support a result
for this explicitly defined local-return board; it cannot certify the RFC board
with only two of its six reference contacts connected.

The source and load connection volume extends 0.075 mm inward from each
electrical endpoint. The source is a prescribed voltage feed over the lower
0.2 mm of substrate, followed by a 30 Ω lumped resistor over the upper 0.2 mm.
The quiet trace has a 30 Ω termination to the plane. The receiver has a 5 pF
lumped capacitor from trace to plane. Vertical voltage probes are at the exact
saved endpoints, relative to their local plane. The source voltage is also
probed and checked, rather than inferred from an excitation parameter.

The copper conductivity in the TSX/3D material is 5.8e7 S/m. FDTD uses PEC:
**conductor loss and internal inductance are not solved**. Small terminal pad
extensions beyond the saved trace endpoints are also omitted, matching the
native extractor's saved trace volumes. Both limitations
are recorded in every run manifest. The geometrical/dielectric comparison is
therefore more specific than a claim of an exact finite-conductivity assembly.

The [conducting-sheet API](https://wiki.openems.de/index.php/Metal_Property.html)
was inspected, not simulated. The installed
[operator implementation](https://github.com/thliebig/openEMS/blob/1d710c210920908a143b573f2babca05455f5479/FDTD/extensions/operator_ext_conductingsheet.cpp)
requires a two-dimensional primitive and falls back to PEC for a volume.
A sheet substitute changes the finite-thickness edge geometry and would need
its own qualification. Merely assigning that property to these boxes would
not establish a finite-conductivity result.

## Installation and disk accounting

No sudo or password was used. A native openEMS package was not available:
the [official package page](https://docs.openems.de/en/latest/install/package.html)
describes the macOS formula as broken/unmaintained; Homebrew core had no formula,
the former upstream tap returned 404, and the conda-forge and PyPI openEMS
package lookups returned 404. The official release asset was for Windows.

The successful route uses Homebrew arm64 **bottles** for Boost 1.92.0_1 and
HDF5 2.2.0, including their bottle dependencies. Only TinyXML, fparser, CSXCAD,
openEMS and their Python bindings are compiled. The current
[headless build requirements](https://docs.openems.de/en/latest/install/requirements.html)
do not require building Qt or VTK. The upstream script builds its small custom
TinyXML automatically.

Installed source identities:

| Component | Revision |
|---|---|
| openEMS project/build scripts | `622ac90e3f37700445df424779465e6a25d3c155` |
| CSXCAD | `fdff4b551580952009c7243a29693e139d1da108` |
| fparser | `4b9c845b449b520c4b8c5f23c74cd04820084f81` |
| openEMS solver | `1d710c210920908a143b573f2babca05455f5479` |
| Python CSXCAD binding | `0.7.0.post1.dev1+gfdff4b551` |
| Python openEMS binding | `0.37.0.post1.dev1+g1d710c210` |

The isolated Python environment is CPython 3.13.15 with NumPy 2.5.4,
Matplotlib 3.11.2, h5py 3.16.0 and Cython 3.3.1. Installation follows the
[upstream headless build workflow](https://docs.openems.de/en/latest/install/clone-build-install.html):

```sh
# Set OPENEMS_ROOT to the scratch prefix below. Check disk before downloads.
diskutil info / | grep 'Container Free'
brew install boost hdf5
uv venv --python 3.13 "$OPENEMS_ROOT/venv"
uv pip install --python "$OPENEMS_ROOT/venv/bin/python" \
  pip numpy matplotlib h5py cython setuptools wheel setuptools-scm
git clone https://github.com/thliebig/openEMS-Project.git "$OPENEMS_ROOT/source"
cd "$OPENEMS_ROOT/source"
git checkout 622ac90e3f37700445df424779465e6a25d3c155
git submodule update --init --depth 1 fparser CSXCAD openEMS
export PATH="$OPENEMS_ROOT/venv/bin:/opt/homebrew/bin:$PATH"
export VIRTUAL_ENV="$OPENEMS_ROOT/venv"
export CSXCAD_INSTALL_PATH="$OPENEMS_ROOT" OPENEMS_INSTALL_PATH="$OPENEMS_ROOT"
export CMAKE_PREFIX_PATH="/opt/homebrew:$OPENEMS_ROOT"
export OMP_NUM_THREADS=1 CMAKE_BUILD_PARALLEL_LEVEL=1 MAKEFLAGS=-j1
./update_openEMS.sh "$OPENEMS_ROOT" --disable-GUI --njobs=1 --skip-dep-check \
  --python --python-venv-mode=disable --python-use-network=disable
```

In this session normal GHCR transfers stalled. Anonymous authenticated range
downloads recovered the public bottles; each assembled bottle was checked
against the Homebrew SHA-256 before pouring. Download concurrency was used only
for network transfer, never for solvers. Task-created bottle and Python download
caches were removed after installation. The source/build log and usage JSON
remain in scratch. The C++/binding build took 204 seconds with a sampled
791 MiB process-tree RSS peak. Bottle installation peaked at 1002 MiB.

Initial container free space was about 8.49 GB. Unrelated cleanup increased it
to about 39 GB before the successful large bottle download; later free-space
changes cannot be attributed to this task. Disk accounting therefore uses
`du`, not the difference between APFS free-space readings. The task guard reads
`diskutil info /` before admission and every five seconds, requires at least
5.3 GB free after the declared download/install reserve, and stops below
5.3 GB. No monitored installation or solver run reached
the 5 GB floor. The following `du -sk` snapshot includes retained source/build
files and diagnostic runs; it excludes the pre-existing uv-managed Python
interpreter (its binary predates this task, 16 September 2026).

| Retained allocation | Decimal GB |
|---|---:|
| New Homebrew kegs | 0.942 |
| Scratch prefix, including everything below it | 0.371 |
| Total of those two allocations | 1.313 |
| Within scratch: Python environment | 0.141 |
| Within scratch: source/build tree | 0.105 |
| Within scratch: result artifacts | 0.107 |

Container free space at the final accounting snapshot was 33.916 GB.
Bottle/Python caches, temporary authentication files and the TinyXML download
archive were removed. Installed libraries, source identities and raw evidence
remain available. Exact KiB/byte figures are in the [compact evidence](openems-referee-data.json).

## Official tutorial verification

The unmodified geometry, mesh, excitation and terminations from the official
[`MSL_NotchFilter.py`](https://github.com/thliebig/openEMS/blob/1d710c210920908a143b573f2babca05455f5479/python/Tutorials/MSL_NotchFilter.py)
were run headlessly with one CPU thread. Tutorial SHA-256:
`d4e5b96ad0fe6931535439893bce236da46ea6b8689d685b543eada81179fddc`.
The wrapper captures the port's extracted line impedance **before** the tutorial
overwrites its reference impedance with 50 Ω for S-parameter normalization.

| Quantity | Measured |
|---|---:|
| Width / dielectric height / relative permittivity | 600 µm / 254 µm / 3.66 |
| Nominal impedance / acceptance band | 50 Ω / ±5% |
| Extracted real impedance, 0.5–2 GHz | 47.594–47.767 Ω |
| Median real impedance | 47.644 Ω |
| Independent thin-strip Hammerstad–Jensen calculation | 47.667 Ω |
| Median difference from that calculation | −0.049% |
| Maximum absolute imaginary impedance | 0.144 Ω |
| Solver cells / timesteps | 269,780 / 13,530 |
| End criterion | −60.07 dB |
| Wrapper elapsed / sampled peak RSS | 55.46 s / 136.2 MiB |

The independent calculation uses the tutorial's w/h=600/254 and εr=3.66 in
the [Qucs technical documentation's Hammerstad–Jensen equations](https://qucs.sourceforge.net/tech/node75.html)
11.4–11.6 and 11.15–11.18, giving εeff=2.875776. The 50 Ω value is the tutorial's
normalization reference; the ±5% gate is an installation sanity check selected
for this experiment, not an upstream published error guarantee.

This verifies the installed solver/bindings and the official MSL port workflow.
It does not establish sub-millivolt waveform
accuracy or validate the controlled-board circuit ports by itself.

## Controlled experiments and numerical checks

| Case | Traces | Centre spacing | Electrical length | Board outline | Plane outline |
|---|---:|---:|---:|---|---|
| `1-0.3` | 1 | n/a | 10 mm | 12 × 3 mm | 11.6 × 2.6 mm |
| `3-0.3` | 3 | 0.3 mm | 10 mm | 12 × 3.6 mm | 11.6 × 3.2 mm |
| `3-1-short` | 3 | 1 mm | 5 mm | 7 × 5 mm | 6.6 × 4.6 mm |

All traces are 0.15 mm wide, with top copper at z=0.4…0.43 mm and bottom
copper at −0.03…0 mm. Bare, lossless dielectric occupies z=0…0.4 mm with
εr=4.36. Plane/board boundaries and trace coordinates come directly from the
archived geometry. Outer traces switch together; the middle trace is quiet.
The intended stimulus is exactly `PULSE(0 3.3 2n 300p 300p 4n 10n)`.

Mesh density 1 uses four lateral intervals per trace; density 2 doubles
lateral/vertical resolution. Final runs use 0.5/0.25 mm longitudinal anchors
to spend the time budget on longer step captures. Both preserve material
interfaces and use the official tutorial's
one-third-inside/two-thirds-outside lateral edge placement. Short anchor gaps
are also graded; the upstream max-resolution smoother alone leaves abrupt
small-to-large gaps. Eight uniform 0.8 mm PML cells lie **outside** the 3 mm
clear-air buffer. Manifests contain mesh dimensions, geometry hashes and all
approximations. No field dumps are requested.

The full mesh is mirrored about x=0 and y=0 after smoothing; there is no
half-domain symmetry boundary. The upstream directional smoother otherwise
breaks geometric symmetry: one rejected coarse coupled run gave a 13 mV
outer-trace difference. Mirroring reduced it to 0.032 mV. All initial
single-trace runs using the asymmetric smoother are also excluded from the
final comparison, despite their apparently favorable mesh convergence.

Each command runs under `scripts/openems-guard.py`: exclusive solver lock,
admission scan for native openEMS/ngspice/FastHenry/FasterCap processes, one or
two solver threads, BLAS limited to one thread, RSS sampled every 0.5 seconds,
and a 1.75 GiB stop threshold below the 2 GiB limit. It also stops at 45 minutes
or when measured timestep progress projects beyond 45 minutes. The RSS limit
is sampled monitoring, not an OS-enforced memory cap. An unrelated Python
binding solver would not be recognized by the native executable-name scan;
the exclusive lock serializes all runs made by these scripts. An idle-sleep
assertion lasts only for a guarded run.

**Timing exception:** the first mirrored coarse `3-0.3` run reports 9407.89 s
inside openEMS, whereas the original Mac monotonic guard counted 342.49 s.
System sleep/wake activity was observed, but the full discrepancy is not
independently attributed. Thus this run is not claimed to meet a 45-minute
wall-time limit, even though its monitored awake duration was below six minutes.
It is excluded from the final mesh pair and retained only as a diagnostic.
The repeat completed in 371.17 s, with identical numeric voltage samples at
matching times for all six probes. File headers differ. The corrected guard
uses the larger of wall-clock and monotonic elapsed times and records both;
after a future sleep/clock gap it stops the run when execution resumes.
The summarizer requires a wall-clock record and checks the resource limits.

An initial fine pilot projected about 93 minutes for 20 ns on one thread.
Production runs therefore measure a 300 ps step directly and reconstruct the
20 ns pulse by linear superposition at 2, 6.3, 12 and 16.3 ns. Beyond the saved
step interval, reconstruction assumes the PEC DC limit (3.3 V driven, 0 V
quiet). The last 0.5 ns residual is recorded per probe. This observed residual
is an empirical tail indicator, **not a rigorous bound on an unmeasured tail**.
The summarizer rejects a tail above 100 µV unless the explicit
`--allow-unsettled-tail` option is used. Raw first-edge peaks/timings are kept
separately from reconstructed pulse metrics.

For a step capture of duration T, pulse superposition through time 2 ns + T
requires only measured step samples. A 5.5 ns capture therefore includes the
first falling-edge undershoot near 7.1 ns without a DC-tail extrapolation.
Later repeated pulses in the 20 ns plots still need that extrapolation.
The compact evidence records metrics for this direct-superposition window
separately. Model waveform errors use the same first 3 ns after ramp onset;
Only the prescribed 2 ns source onset is applied; no timing alignment is fitted.

Two diagnostic mistakes were detected before using results: soft lumped-port
excitation is field-normalized rather than a prescribed source voltage, and
using a face-aligned coarse lateral mesh/PML inside the clear buffer changed
the single-trace peak by tens of millivolts. Those runs remain labeled diagnostic
in scratch and are excluded from the final mesh pair. The corrected hard-source
voltage is independently probed on every driven trace.

Archived decks saved only far-end probes. `prepare-openems-reference.py` appends
near-end probes, then identical decks are rerun serially in ngspice. The
summarizer checks their far-end voltages against the archived waveforms with
a 0.1 µV limit. A separate zero-channel-resistance sensitivity removes resistance
and mutual-resistance terms while keeping 30 Ω drivers; a 1 µΩ per-section
resistor floor avoids numerical ill conditioning. It retains all L/C values.
The native decks use a single 100 MHz R/L sample, not broadband conductor loss.
Removing R leaves their internal-inductance contribution in L: this diagnostic
is not a fresh PEC extraction and does not bound the finite-conductivity error.

## Results

All six accepted captures and the boundary check are complete. Accepted here
means execution and port-sanity checks passed; it does not establish a
continuum-error bound. These are common first-pulse metrics through about
7.499 ns, obtained without an extrapolated step tail. Quiet peaks are maximum absolute
voltage; S0 is the driven outer receiver. The t50 column is the first crossing
of 1.65 V, measured from simulation zero; the intended source crosses at 2150 ps.
All probes, signed extrema and exact window ends are retained in the evidence.

| `1-0.3` method | S0 peak V | S0 minimum V | S0 t50 ps |
|---|---:|---:|---:|
| Recorded 3D | 3.841114 | −0.541116 | 2373.851 |
| Recorded 2D | 3.822233 | −0.522232 | 2371.695 |
| openEMS coarse | 3.852958 | −0.552708 | 2374.847 |
| openEMS fine | 3.849401 | −0.550706 | 2374.692 |

3D is closer in peak, undershoot and t50. Its first-edge RMS error is 4.745 mV,
versus 15.045 mV for 2D; maximum errors are 12.579 versus 37.812 mV.

| `3-0.3` method | S0 peak V | S0 minimum V | S0 t50 ps | Quiet near peak mV | Quiet far peak mV |
|---|---:|---:|---:|---:|---:|
| Recorded 3D | 3.873395 | −0.573109 | 2383.251 | 520.962 | 597.515 |
| Recorded 2D | 3.855873 | −0.555592 | 2381.052 | 521.372 | 588.326 |
| openEMS coarse | 3.878053 | −0.577936 | 2384.271 | 525.793 | 607.742 |
| openEMS fine | 3.877014 | −0.576642 | 2383.967 | 526.809 | 610.266 |

3D is closer for the driven receiver and far-end crosstalk. Neither matches
the fine far-victim peak within the earlier investigation's 1% + 1 mV gate.
Near-end peak closeness is unresolved: the two archived paths differ by
0.410 mV while the observed mesh change is 1.016 mV. The near-end waveform
itself favors 3D (first-edge RMS 6.937 versus 15.039 mV for 2D).

| `3-1-short` method | S0 peak V | S0 minimum V | S0 t50 ps | Quiet near peak mV | Quiet far peak mV |
|---|---:|---:|---:|---:|---:|
| Recorded 3D | 3.508058 | −0.208059 | 2328.430 | 138.261 | 102.568 |
| Recorded 2D | 3.472888 | −0.172889 | 2324.685 | 118.284 | 86.095 |
| openEMS coarse | 3.497294 | −0.197543 | 2327.262 | 119.046 | 88.905 |
| openEMS fine | 3.500337 | −0.200401 | 2327.539 | 118.733 | 90.077 |

This is a mixed result: 3D is closer for the driven peak, undershoot and t50;
2D is closer for both quiet probes. Relative to fine FDTD, 3D overstates the
near/far quiet absolute peaks by 19.528/12.491 mV. The 2D errors are
0.449/3.982 mV. First-edge RMS errors are 5.784/5.488 mV for 3D's near/far
quiet probes, versus 3.305/2.346 mV for 2D.

| Case | Driven receiver closer | Quiet near closer | Quiet far closer |
|---|---|---|---|
| Single 10 mm | 3D | n/a | n/a |
| Three, 0.3 mm / 10 mm | 3D | Peak unresolved; waveform 3D | 3D |
| Three, 1 mm / 5 mm | 3D | 2D | 2D |

Closest means closest to the defined finite-plane PEC/local-port experiment.
There is no universal winner. Applying a band of 1% of the fine absolute
peak + 1 mV, both native paths miss the far-victim peak in both coupled cases.
Numerical proximity therefore does not qualify either complete extraction
path for the RFC assembly.

## Convergence and execution records

All accepted meshes used two solver threads. `Cells` below is the product
of the three interval counts; openEMS reports the product of node counts
in its timing log instead. RSS is the sampled solver-process-tree peak.

| Case / density | Mesh nodes x × y × z | Cells | Wall minutes | Peak MiB |
|---|---|---:|---:|---:|
| 1-0.3 / 1 | 63 × 59 × 49 | 172,608 | 9.60 | 85.22 |
| 1-0.3 / 2 | 83 × 67 × 54 | 286,836 | 15.53 | 118.81 |
| 3-0.3 / 1 | 63 × 77 × 49 | 226,176 | 6.19 | 101.48 |
| 3-0.3 / 2 | 83 × 95 × 54 | 408,524 | 16.89 | 130.75 |
| 3-1-short / 1 | 53 × 91 × 49 | 224,640 | 7.59 | 106.03 |
| 3-1-short / 2 | 63 × 113 × 54 | 368,032 | 12.50 | 128.58 |

The minimum recorded container free space across accepted captures was
31.512 GB; the largest source-voltage error was 0.562 mV, and the largest
mirrored outer-trace discrepancy was 0.0585 mV. No accepted capture stopped
a resource guard. The excluded timing exception is described above.

First-pulse coarse-to-fine sensitivities are:

| Case | Driven peak mV | Undershoot mV | t50 ps | Quiet near peak mV | Quiet far peak mV |
|---|---:|---:|---:|---:|---:|
| 1-0.3 | 3.557 | 2.002 | 0.155 | n/a | n/a |
| 3-0.3 | 1.039 | 1.294 | 0.304 | 1.016 | 2.523 |
| 3-1-short | 3.043 | 2.859 | 0.277 | 0.313 | 1.172 |

Maximum pointwise step-waveform changes (driven far / quiet near / quiet far)
are 1-0.3: 5.452 mV; 3-0.3: 5.551/7.654/7.970 mV; and 3-1-short:
5.643/2.959/2.488 mV. These are observed two-mesh sensitivities, not rigorous
continuum-error bounds.

First-edge RMS errors use the first 3 ns after ramp onset without fitted
alignment. The grid column is the observed coarse-to-fine RMS change over
that same interval.

| Case / probe | 3D error mV | 2D error mV | Grid change mV |
|---|---:|---:|---:|
| 1-0.3 / far-0 | 4.745 | 15.045 | 1.692 |
| 3-0.3 / far-0 | 5.757 | 15.952 | 1.303 |
| 3-0.3 / near-1 | 6.937 | 15.039 | 1.778 |
| 3-0.3 / far-1 | 6.540 | 16.884 | 2.569 |
| 3-1-short / far-0 | 4.462 | 10.757 | 1.715 |
| 3-1-short / near-1 | 5.784 | 3.305 | 0.450 |
| 3-1-short / far-1 | 5.488 | 2.346 | 0.857 |

A separate coarse `3-0.3` run increased the clear-air buffer from 3 to 6 mm.
It used 71 × 85 × 57 nodes, 7.01 wall minutes and 120.25 MiB peak RSS.
The changed air grid also changes the timestep; these are combined
buffer/grid sensitivities, not rigorous absorber-error bounds.

| Probe | Absolute peak change mV | Maximum step-waveform change mV |
|---|---:|---:|
| far-0 | 0.045 | 0.272 |
| near-1 | 0.126 | 0.580 |
| far-1 | 0.150 | 0.568 |

Driven first-undershoot change was 0.057 mV and t50 change was 0.030 ps.
These sensitivities are smaller than the corresponding mesh changes.

Zero-channel-R sensitivity changes driven peaks by 4.403/4.512 mV
(3D/2D, single), 3.383/3.499 mV (tight coupled), and 1.601/1.548 mV
(wide spaced). It preserves the closest driven and quiet-waveform models
listed above. All L/C values, including internal L, remain in that ablation;
it cannot bound the finite-conductivity difference.

Fine-mesh last-half-nanosecond step residuals reach 1.517 / 2.101 / 1.873 mV
for single / tight / wide cases. Thus the full 20 ns plots require the stated
DC-tail assumption. All tabulated first-pulse peaks/undershoots use measured
step samples only. Two meshes establish observed sensitivity, not an absolute
continuum accuracy guarantee.

## Physical interpretation and concrete next increment

The uniform 2D cross-section model omits finite signal ends, terminal current
injection and finite-plane/contact spreading. Those are plausible causes of
its earlier edge and smaller overshoot in the completed controls. The present
voltage measurements do not uniquely separate an L error from an end-C or
port-field error. The PEC calculation also cannot attribute a discrepancy to
skin effect or internal inductance.

The 3D comparison retains finite geometry but has a different return contract.
`groundConnection` in [routed geometry](../src/board/geometry/routed.ts) replaces
a broad rectangular pad with its inscribed disk. The
[FastHenry deck](../src/extraction/decks.ts) exposes one common return pair,
and [loop reduction](../src/extraction/checks.ts) enforces that incidence.
Positive energy and the exact return-energy decomposition validate the
algebra; they do not validate which physical contacts carry return current.

The 3D deck also spreads its integrated finite-geometry matrices over 16
uniform π sections. It has no localized terminal/end block, so correct total
L/C need not reproduce where terminal coupling occurs. This is another known
modeling omission; its quantitative contribution is not isolated here.

The short, wide-spaced victim result is consistent with excess common-return
coupling from that shared-contact reduction, while the driven receiver still
benefits from finite-geometry terms absent from the uniform 2D model. This is
an inference, not an isolated contact ablation. Archived native mesh checks
passed as recorded in step 4; they were not rerun here. Contact topology,
100 MHz/internal-inductance choices and terminal fields remain distinct
possible contributors to the error.

The next implementation increment should:

1. Retain actual reference-pad footprints and all intended physical return
   terminals in the geometry contract. Add an actual TSX reproduction with
   explicit local versus shared contacts and identical voltage-probe paths.
2. Extract the finite return as a multiport network before reducing its
   terminal currents. Match source/load return locations and external lead
   paths between field models, including a two-contact realization if that
   is the intended assembly.
3. Reuse the uniform BEM RLGC bulk for speed and attach a passive finite
   terminal/end network for the geometry it omits. Validate complex port
   impedance/capacitance and complete waveforms. The existing
   [return closure](../src/extraction/route-return.ts) is a diagnostic starting
   point; its rank-one term alone is not a complete finite-geometry correction.
4. Compare causal broadband R/L with the 100 MHz snapshot separately. A
   zero-R ablation retaining the same L does not solve that qualification.

The optional two-of-six-contact full-wave variant is not claimed here. I have
not defined a physically matched full-wave realization of its shared external
terminals: the saved ground coordinates do not specify external source/load
lead paths. Adding an arbitrary harness would define another experiment.
The RFC's 1.7 nH return contribution and six-case qualification therefore
remain outside this study's verified result.

## Reproducing and locating evidence

All raw outputs, installation, logs and standalone overlay PNGs are under:

```text
/private/tmp/claude-501/-Users-ankan--t3-scratch-2026-11-07-git-github-com-tscircuit-signal-883a95fb/ac5d97ea-4f1f-43ef-89c3-8b01ba252da3/scratchpad/openems
```

From the repository root, set `OPENEMS_ROOT` to that path.

The given step-4 native archives are reused, not freshly rendered or
re-extracted in this study. Their TSX generator is
[`check-return-agreement.tsx`](../scripts/check-return-agreement.tsx), invoked
with `node --import tsx scripts/check-return-agreement.tsx` once repository
dependencies and native field solvers are available. That command starts field
solvers and must run separately from openEMS. Archive hashes in the evidence
identify the exact inputs used here. These ignored archives are required;
a fresh checkout needs that preceding TSX/native generation step.

An example controlled run is:

```sh
python3 scripts/openems-guard.py --threads 2 --reserve-gb .1 --project-ns 5.5 \
  --log "$OPENEMS_ROOT/results/3-0.3/mesh-1.log" \
  --usage "$OPENEMS_ROOT/results/3-0.3/mesh-1/usage.json" -- \
  "$OPENEMS_ROOT/venv/bin/python" scripts/run-openems-control.py \
  3-0.3 "$OPENEMS_ROOT/results/3-0.3/mesh-1" \
  --density 1 --duration-ns 5.5 --longitudinal-mm .5 --step-response --threads 2
```

Repeat the controlled command for densities 1 and 2 and each case. Run one
guarded command at a time. After all captures and the reference probe reruns:

```sh
"$OPENEMS_ROOT/venv/bin/python" scripts/summarize-openems.py \
  "$OPENEMS_ROOT/results" --allow-unsettled-tail
```

The tutorial wrapper is
`scripts/check-openems-tutorial.py`; near-end/reference deck preparation is
`scripts/prepare-openems-reference.py`; analysis and plots are generated by
`scripts/summarize-openems.py`. Raw simulations and vendor IBIS files are not
added to Git. Only research scripts, the report and compact evidence metadata
are included in the local commit.

## Verification performed

The official tutorial, six accepted controlled runs (including the replacement
coarse capture), and buffer check completed. All five Python scripts parse.
The summarizer rejects
the excluded capture lacking a wall-clock record and rejects an unsettled
step tail without the explicit override. A separate watchdog smoke check
killed a three-second sleeping child after 0.73 s with a 0.1 s budget; that
checks termination behavior, not electromagnetics. All three PNGs were
visually inspected, and regeneration produced identical image hashes.

`node --test tests/tooling/docs.test.ts` passes all five existing documentation
checks. Project-wide pnpm build/typecheck/lint/test commands were not run: this
checkout has no repository dependencies installed. The measurements and these
verification limits are retained in the compact JSON; raw probes and PNGs
remain in scratch, outside Git.
