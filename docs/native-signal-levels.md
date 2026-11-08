# Native signal API evidence

Source: the TSX fixtures in `examples/levels`, rendered with the installed core and
`tests/support/signal-render.tsx`. The adapter supplies the unpublished SI records
and bridges the old required IBIS corner/package props. Stackup comes from core's
1.6 mm, four-layer JLC preset. These are designed pad/channel fixtures, not physical
package land patterns or manufactured boards. PDN is explicitly ideal in these runs.

The native commands use FastHenry, FasterCap and ngspice from `/opt/homebrew/bin`.
Both Level 1 runs completed through the public `runPipeline` entry, with all scalar
signal, power and ground package R/L/C present. Scalar packages use a declared pi
approximation (half of the vendor C at board and die; ground-pin C spans its lead).
Initial channel charge follows declared logic levels; those constraints apply only
during startup and eyes omit 16 UI. Each run sends 48 UI with independent seeded PRBS7.

| TSX case | Native wall time | Eye height | Eye width | Receiver limits |
| --- | ---: | ---: | ---: | --- |
| Level 1 SN74LVC1G04 single-ended | 42.633 s | 3.299984 V | 49.25 ns | VIL 0.8 V, VIH 2.0 V |
| Level 1 SN65HVD72 differential + 120 ohm RTERM | 16.660 s | 4.468902 V | 3.92 us | differential -0.2/+0.2 V |

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

Level 3 traffic, quiet-low and quiet-high native measurements are in progress.
Strobe/DDR timing currently has analytic measurement tests, not a native DDR device run.
Coupled package matrices, arbitrary branched routed graphs, and extracted multi-port
PDN remain unsupported and fail explicitly. These are outstanding RFC requirements.
This draft does not claim full RFC implementation or a validated SI/DDR system.
