# Coupling-group research spike

This is a research branch stacked on `fix/routed-ddr3-level4`. Native measurements are recorded below; the DDR victim-window pilot is a negative result. It does not change the pipeline's default deck.

`simulation/route-partition.ts` builds a net graph from solved RLGC/loss matrices,
actual source connectivity, physical contacts, emitted oblique capacitance, and
indivisible compiled IBIS bindings. Exact components retain every nonzero edge.
Victim windows admit direct neighbours where `max(abs(k), normalized C score) > threshold`,
then close physical/passive and compiled-model dependencies. `Cm` is normalized
local parallel C; the oblique score is the emitted encounter C divided by the
geometric mean of the nets' integrated self C. All mutual terms between included
nets remain intact; dropped terms are the window boundary, including strong
aggressor-to-excluded-neighbour interactions. A one-hop window is not a thresholded
connected component.

Projection retains principal submatrices and their original diagonals. Excluded
conductors therefore remain implicit AC-grounded electrostatic loading in self C;
this approximation is explicit. Excluded series currents are set to zero. Projected cross-section keys identify the original coefficient indices and these mixed boundary conditions. It does not re-extract the geometry. Full-network
delay bounds retain the same spatial mesh. Quiet drivers retain their compiled
schedules and real IBIS terminations. Compiled multi-pin packages are never split.
Ideal independent supply sources and unrelated selected electrical passives are
copied; nonideal shared binding nodes close components. Finite shared-return
experiments are rejected.

Dropped electric and magnetic values are absolute quadratic cross-term bounds at
caller-supplied voltage/current limits, not measured energy or waveform-error
bounds. Mutual resistance and loss coefficients are accounted separately. Removing
an entire remote route also removes its self energy; that is not included in the
cross-term bound. These bounds do not qualify the waveform approximation.

```mermaid
flowchart LR
  fields[Solved route matrices and full deck evidence] --> graph[Net graph including oblique terms and IBIS bindings]
  graph --> exact[Exact connected components]
  graph --> windows[Victim windows and binding closure]
  exact --> projection[Principal submatrices with original mesh bound]
  windows --> projection
  projection --> network[Existing RouteNetworkSolver and deck assembly]
  network --> native[Serial locked bounded native measurement]
  native --> report[Parity, errors and cost evidence]
```

## Reproduce locally

Set `IBIS_MODEL_DIR`, `SI_GROUPS_DIR` (an ignored or external artifact directory),
and `SI_NGSPICE_LOCK` to the shared machine-wide lock script. DDR additionally
requires `SI_DDR3_BOARD` as documented in the root README. Local RFC builds of
circuit-json, props and core are required. No dependency changes are committed.

```sh
SI_GROUPS_SHORT_WINDOWS=1 SI_GROUPS_UI_COUNT=8 SI_GROUPS_STEP_DIVISOR=8 SI_GROUPS_TIGHT_TOLERANCES=1 node --import tsx scripts/research-coupling-groups.tsx compile small
node --import tsx scripts/research-coupling-groups.tsx measure small
# Optional extra cut experiment: set SI_GROUPS_THRESHOLDS=0.6 when compiling small.
node --import tsx scripts/research-coupling-groups.tsx compile ddr
node --import tsx scripts/research-coupling-groups.tsx measure ddr
```

Every measurement invokes `research-coupling-native.py`, which acquires
`SI_NGSPICE_LOCK` before starting ngspice. Timers exclude lock waits. The default
native limit is 90 s for small boards and 600 s for DDR; set
`SI_GROUPS_TIMEOUT_SECONDS` to a smaller positive value for a bounded pilot. Values
above 600 s are rejected. Each DDR deck requests 0–1 ns, retaining the original
8 ns model schedules. Raw transients, input snapshots, vendor-generated decks,
logs and per-case timing stay in `SI_GROUPS_DIR`. Exact duplicate deck bytes share
one measurement; each source partition and its own emitted deck remain indexed.

## Measured DDR graph

This scope includes **91 routed electrical nets**, of which 24 are addr/cmd/clock
signals. The recompiled full deck has 1,835 cells, 36,814 K terms, and 17,518,974
bytes at this branch's local RFC builds. The graph below precedes package/binding
closure. Thresholds use strict `>` comparisons.

| Threshold | k edges | k components | Largest k component | k/Cm/oblique-score edges | Combined components | Largest combined component |
|---:|---:|---:|---:|---:|---:|---:|
| > 0 | 167 | 16 | 70 | 225 | 7 | 76 |
| > 0.01 | 123 | 21 | 66 | 134 | 18 | 69 |
| > 0.03 | 84 | 32 | 47 | 85 | 31 | 47 |
| > 0.1 | 52 | 55 | 20 | 52 | 55 | 20 |

Including all RLGC/loss, oblique and binding dependencies gives exact component
sizes **86, 1, 1, 1, 1, 1**. The largest exact deck retains **1,765 cells** and
**17,352,583 bytes**: only 3.8% fewer cells and 0.95% fewer bytes than the full deck.
All 24 declared signal pins share each of the two compiled IBIS package bindings;
they must remain together. Victim windows at the three thresholds contain 24–33
nets. That is a conservative package-preserving result, rather than a claim that
24 pins can be independently simulated without package reduction.

| Quantity | Count | Minimum | Median | P90 | P99 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| All emitted abs(K), including package | 36,814 | 2.70e-16 | 0.001149 | 0.02203 | 0.08915 | 0.62255 |
| Per-net-pair maximum route abs(k) | 167 | 2.08e-8 | 0.03070 | 0.30242 | 0.53074 | 0.56064 |
| Per-net-pair maximum normalized C score | 225 | 1.41e-10 | 0.007859 | 0.19993 | 0.46953 | 0.53539 |
| Integrated absolute mutual C per net pair, fF | 225 | 2.42e-8 | 4.156 | 87.61 | 583.48 | 1,299.43 |

The existing extraction screen recorded 7,664 parallel pair solves, retaining
2,518 and excluding 5,146 below its 0.5% admission rule. These pre-existing
omissions belong to the baseline and cannot be recovered by exact partitioning.
There are 8,559 oblique encounter records, 8,544 with positive C, totalling
4.648 pF before aggregation. Exact means exact relative to this already extracted
candidate network, not a qualification of the field-model omissions.

[Every scoped net's neighbours at k > 0.01, 0.03 and 0.1](coupling-groups-neighbours.md)
are listed separately to keep the summary readable.


## Native evidence and current verdict

The full DDR reference completed **0–1 ns in 502.654 s**, with **90 finite saved
points** and **24 finite receiver probes**, under the shared machine lock and a
600 s native deadline. Its amortized cost is **5.585 s per saved point**, including
setup and operating-point work. This prefix contains no switching edges: addr/cmd
receiver values remain near zero and CKn remains near 1.5 V. It is not an 8 ns
switching capture.

The common 24-net victim window (721 cells, 10,869,484 bytes, 25,131 K terms),
used at every tested threshold, **aborted after 265.686 s**. Ngspice reported
`Timestep too small` at **12.5555 fs**, with timestep **2.99268e-24 s**, at
`arcd688`. There are only nine partial saved points; **29.521 s/point is a failed-run
diagnostic, not a usable transient cost**. This window cannot reproduce the full
1 ns capture or support an 8 ns completion forecast. It is a negative result even
though the deck is smaller. The native deadline was 600 s; the engine aborted
before that deadline.

The exact dominant component retains **all 36,814 K terms** and completed in
**500.325 s**, with 90 points and **0 mV** difference on all 24 receiver probes
against the full quiet prefix. Each of the five isolated exact components
completed 1 ns in less than 0.1 s. Total serial exact cost is **500.638 s** versus
502.654 s full: a single-run difference of 0.40%, with no useful speedup. Peak RSS
was 1.290 GB versus 1.295 GB full. A preliminary 60 s dominant-component pilot
timed out without readable points; the completed 600 s capture supersedes it. All 72 victim
windows and all six exact component decks have been emitted. Identical windows
reduce to 15 distinct runs at threshold 0.01, 11 at 0.03, and 5 at 0.1 (21 across
all thresholds). Per-partition sizes, dropped-term amplitude bounds and native
costs are in [the cost table](coupling-groups-ddr-costs.md). Preliminary limits were
60 s; extended window measurements use the full 600 s hard cap. Their remaining
entries are explicitly pending until measured.

A purely linear extrapolation of the full quiet prefix gives **4,021 s / 67.0 min
for 8 ns**. This assumes unchanged timestep density and cost and is **not a
forecast of the switching interval**. It does not refute the original 8–25 h
active-run estimate. The equivalent quiet-prefix extrapolation for all exact components is
**4,005 s / 66.8 min**. Exact splitting leaves the dominant workload near the
full deck because it retains every K term; victim-window completion cannot be
projected from an aborted run. No DDR threshold is qualified by this spike.

There is a separate baseline limitation: **67 of the 91 scoped nets have no
vendor endpoint binding**. The 24 declared nets retain their real IBIS models,
reference connections and quiet-driver schedules. Other included neighbours
retain the baseline open/ideal-logical terminations and the existing warnings;
this spike does not invent vendor loads. Thus the requested real-termination
qualification cannot be claimed for those neighbours.

## Small-board parity and temporal resolution

The initial bounded measurements compared full and projected native traces on
the union of their adaptive time grids, using linear interpolation of actual
samples. They used 40 ns for two-trace, 16 us for differential, and 200 ns for
level2/level3. Each individual ngspice run had a 90 s hard deadline and ran under
the shared lock.

| Case | Exact components | EXACT maximum error, mV | Victim 0.01 | Victim 0.03 | Victim 0.1 |
|---|---:|---:|---:|---:|---:|
| two-trace | 1 | 0 | 0 | 0 | 0 |
| level1-differential | 1 | 0 | 0 | 0 | 0 |
| level2 | 2 | 1.80e-14 | 1.80e-14 | 1.80e-14 | 1.80e-14 |
| level3 TRAFFIC | 3 | **8.9783** | **8.9783** | **8.9783** | **8.9783** |
| level3 XTALK_LOW | 3 | 1.99e-7 | 1.99e-7 | 1.99e-7 | 1.99e-7 |
| level3 XTALK_HIGH | 3 | 2.08e-7 | 2.08e-7 | 2.08e-7 | 2.08e-7 |

Two-trace and differential retain their complete network at these thresholds,
so byte-identical decks reuse the full-deck measurement. Level2/level3 are actual
independent emitted decks; their extracted graph has no inter-net edges. At these
thresholds their windows equal their exact components, so these rows do not
validate dropping a nonzero coupling. The 8.9783 mV TRAFFIC discrepancy is retained
as failed evidence. A controlled repeat with maximum timestep divided by four, and longer prefixes
(32 us differential and 400 ns level2/level3), still failed the TRAFFIC criterion
at **1.8913 mV**. The final bounded repeat used timestep divided by eight and
`reltol=1e-6`, `abstol=1e-12`, `vntol=1e-8` for both full and cut decks. It retained
the same physical network and original driver schedules. All final captures
completed, and every EXACT comparison meets 1 mV:

| Case | EXACT maximum error, mV | Victim 0.01 | Victim 0.03 | Victim 0.1 |
|---|---:|---:|---:|---:|
| two-trace | 0 | 0 | 0 | 0 |
| level1-differential | 0 | 0 | 0 | 0 |
| level2 | 0.126532 | 0.126532 | 0.126532 | 0.126532 |
| level3 TRAFFIC | 0.569092 | 0.569092 | 0.569092 | 0.569092 |
| level3 XTALK_LOW | 2.862e-6 | 2.862e-6 | 2.862e-6 | 2.862e-6 |
| level3 XTALK_HIGH | 2.881e-6 | 2.881e-6 | 2.881e-6 | 2.881e-6 |

The committed runner reproduced all 64 tightened deck hashes from these captures.
These are native waveform comparisons, not pure-function test outputs. The
original and refined failures show that numerical controls matter even for
algebraically independent circuits. The small-board victim rows do not establish
DDR approximation accuracy: they do not discard a nonzero coupling. The DDR
window that aborts provides no valid full-window error measurement.

Local lint (one pre-existing mesh-length warning), module and vocabulary checks,
and all project typecheck configurations pass with local RFC dependency builds.
The full suite passed 281 tests with 37 skips; focused partition checks passed
four tests after the projection-evidence changes. CI still fails because the
published circuit-json dependency lacks the required RFC exports. Dependency
files are unchanged. This is a draft research result; no merge is requested.
