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
