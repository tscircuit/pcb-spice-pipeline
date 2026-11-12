# Coupling-group research spike

This is a research branch stacked on `fix/routed-ddr3-level4`. Native measurements
and the DDR verdict are pending. It does not change the pipeline's default deck.

`simulation/route-partition.ts` builds a net graph from solved RLGC/loss matrices,
actual source connectivity, physical contacts, emitted oblique capacitance, and
indivisible compiled IBIS bindings. Exact components retain every nonzero edge.
Victim windows admit direct neighbours where `max(abs(k), abs(Cm)) > threshold`,
then close physical/passive and compiled-model dependencies. `Cm` is normalized
local parallel C; the oblique score is the emitted encounter C divided by the
geometric mean of the nets' integrated self C. All mutual terms between included
nets remain intact; dropped terms are the window boundary, including strong
aggressor-to-excluded-neighbour interactions. A one-hop window is not a thresholded
connected component.

Projection retains principal submatrices and their original diagonals. Excluded
conductors therefore remain implicit AC-grounded electrostatic loading in self C;
this approximation is explicit. It does not re-extract the geometry. Full-network
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
node --import tsx scripts/research-coupling-groups.tsx compile small
node --import tsx scripts/research-coupling-groups.tsx measure small
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
