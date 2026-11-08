# Native signal API evidence

Source: the TSX fixtures in `examples/levels`, rendered with the installed core and
`tests/support/signal-render.tsx`. The adapter supplies the unpublished SI records
and bridges the old required IBIS corner/package props. Stackup comes from core's
1.6 mm, four-layer JLC preset. These are designed pad/channel fixtures, not physical
package land patterns or manufactured boards. PDN is ideal in these runs (the default); `pdn="extracted"` is not implemented yet.

The native commands use FastHenry, FasterCap and ngspice from `/opt/homebrew/bin`.
All three requested cases completed through the public `runPipeline` entry, with all scalar
signal, power and ground package R/L/C present. Scalar packages use a declared pi
approximation (half of the vendor C at board and die; ground-pin C spans its lead).
Initial channel charge follows declared logic levels; those constraints apply only
during startup and eyes omit 16 UI. Each block sends 48 UI with independent seeded PRBS7. The committed convergence residuals are 0.275% (SE), 0.0000363% (differential), and 0.845% / 0.770% / 0.566% (Level 3 traffic / quiet low / quiet high).

| TSX case | Native wall time | Eye height | Eye width | Receiver limits |
| --- | ---: | ---: | ---: | --- |
| Level 1 SN74LVC1G04 single-ended | 64.071 s | 3.299984 V | 49.25 ns | VIL 0.8 V, VIH 2.0 V |
| Level 1 SN65HVD72 differential + 120 ohm RTERM | 17.159 s | 4.468902 V | 3.92 us | differential -0.2/+0.2 V |

Raw measured summaries, matrices, vendor hashes and numerical settings are committed
under `tests/evidence/signal-levels`. Full generated inputs, decks, requests, logs
and adaptive waveform samples stay in the ignored `runs/levels` directory.
The real TI IBIS files are not redistributed. `examples/vendor-models.lock.json`
records their public sources and SHA-256 values.

FastHenry R/L refinement must meet 5%; FasterCap automatic refinement must meet 2%,
with reciprocity, passivity, independent DC resistance and charge/energy checks.
Transient refinement doubles sections and halves maximum timestep until RMS waveform
difference after settling is <=1% of observed amplitude on 20,000 uniform time points.
This does not bound pointwise overshoot error or establish hardware accuracy.

Level 3 completed in 781.183 s. All three block states used the same three actual
routed traces and the same real TI SN74LVC1G04 models. The central D1 is the quiet
victim in the second and third blocks; D0 and D2 keep switching. Quiet receivers
have waveforms and NEXT/FEXT, and deliberately have no eye.

| Level 3 block | Active eye height (D0 / D1 / D2) | Active eye width | Victim NEXT | Victim FEXT |
| --- | --- | ---: | ---: | ---: |
| Traffic | 3.299957 / 3.299945 / 3.299944 V | 47.25 ns | n/a | n/a |
| Quiet low | 3.299967 / quiet / 3.299964 V | 49.25 ns | 1.744851 V | 1.318696 V |
| Quiet high | 3.299963 / quiet / 3.299963 V | 49.25 ns | 1.310514 V | 1.284440 V |

NEXT/FEXT are absolute peak deviations from each probe's time-weighted mean
voltage after 16 UI; they are not the raw quiet-high DC level. These large victim
excursions belong to this narrow, distant coplanar return fixture. They are not
predictions for a production board or a model of a continuous ground plane.

The Level 3 run made 13 real native process calls: six FastHenry, one FasterCap,
and six ngspice (baseline plus refinement for each block). Identical extraction
requests reused freshly obtained results within this one call, with block, request
SHA-256 and reuse provenance recorded; no transient was reused. FastHenry 3.0.1,
FasterCap 6.0.7, and ngspice 47 ran locally. Each final channel used four pi
sections. The source-record permutation test checks identical derived settings
and actual geometry with four physical signal conductors; no larger native run
or native permutation rerun is claimed.
Strobe/DDR timing currently has analytic measurement tests, not a native DDR device run.
Coupled package matrices, arbitrary branched routed graphs, and extracted multi-port
PDN remain unsupported and fail explicitly. These are outstanding RFC requirements.
This draft does not claim full RFC implementation or a validated SI/DDR system.

Threshold interpretation follows the official [IBIS specification](https://ibis.org/ver8.0/ver8_0.pdf):
`Vinh_ac`/`Vinl_ac` are offsets from `Vth`, and `Vdiff_ac` overrides `[Diff_pin]`.
Supply/Vref-sensitive thresholds require explicit mask limits instead of assuming
a reference voltage. Only the two vendor models above have been validated natively.
