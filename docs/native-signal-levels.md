# Native PCB transient channel evidence

This draft follows RFC #28 at `89a2635`. The examples now use the actual
`simulation.pcbtransientchannelsimulation`, `simulation.pcbchannel` and
`simulation.ibismodel` elements rendered by the sibling core build. Public results
contain only receiver/quiet-driver waveforms and listed-leg total RLGC matrices.

| Case | Current verified outcome |
| --- | --- |
| Level 1 single-ended | Accepted 7.2 µs capture; 1,580,521 native samples; final independent RMS 1.542 mV and signed-extrema delta 1.987 mV; 400.664 s runner wall time. |
| Level 1 differential | Native verification in progress. |
| Level 2 | Native verification pending the differential case. |
| Level 3 TRAFFIC / XTALK_LOW / XTALK_HIGH | Native verification pending Level 2; prior quiet captures are retained separately and cannot substitute for changed native requests. |
| Level 4 DDR3 write | Real-core physical rendering: 14 traces, 16 vias, two pours. Core and pipeline package admission reject the coupled package; zero native calls. |

The exact DDR3 stop is `.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.`
The physical layout uses the user's preplaced byte-lane routes, rather than an
unfinished BGA autoroute. Its intended waveforms remain unavailable.

## Numerical contract

R/L retain the signal-minus-return loop transform and 5% mesh criterion. C and G
select the grounded primitive signal block. The raw signal-block C reciprocity
limit remains 2.5%; only a passing block is symmetrized. FasterCap's auto residual
limit is 2%. The return's own excitation is diagnostic and is not the signal-block
acceptance check. The earlier charge-neutral reduction and reports based on it
are superseded.

Transient acceptance independently refines timestep and section count. Every probe
must satisfy time-weighted RMS and both signed-extrema comparisons on all native
adaptive times, at the unchanged 1% + 1 mV limits. There are no eye, mask, receiver
threshold, crosstalk-peak or setup/hold measurements. Quiet waveforms carry the
separately solved undisturbed idle voltage. `pdn="ideal"` constrains die rails and
retains scalar package R/L/C on signal, power and ground pins. Extracted PDN,
coupled packages and branched routed graphs retain explicit errors.

## Reproduction

Build circuit-json `bac86bb`, props `ec2b735` and core `35cb9b6` and use their local,
ignored dependency overlays. Vendor IBIS bytes stay under ignored `models/`.

```sh
export OMP_NUM_THREADS=1 IBIS_MODEL_DIR=models
export SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js"
export TSX_TSCONFIG_PATH=examples/tsconfig.json
export NGSPICE_BIN=/opt/homebrew/bin/ngspice
node --max-old-space-size=6000 --import tsx scripts/run-signal-levels.tsx
node --max-old-space-size=6000 --import tsx scripts/render-example-images.tsx
```

The runner checks memory before each uncached native process and refuses overlap.
Cases and blocks run sequentially. The per-process timeout is 1200000 ms; it is a
runner setting, not an acceptance limit. `SI_EXTRACTION_CACHE` accepts colon-separated
local evidence directories; `SI_REPLAY_COMPLETE_NATIVE=1` permits reuse only of
byte-identical completed native requests. Reuse is recorded per request.

Full accepted waveforms and exact native requests/logs are losslessly archived in
ignored `runs/final-rfc/`. Committed evidence contains hashes, convergence history
and provenance; no vendor bytes or solver decks are redistributed. Example CSVs
use only actual native samples and are decimated only when the full long-format
file exceeds 10 MB. The generation command and outcomes are in `examples/README.md`.
All five output panels and complete repository checks will be refreshed after
sequential native verification finishes. This remains a draft; published sibling
dependencies do not yet contain the shared RFC schemas.
