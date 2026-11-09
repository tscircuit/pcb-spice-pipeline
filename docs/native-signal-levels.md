# Native PCB transient channel evidence

This draft follows RFC #28 at `89a2635`. The examples now use the actual
`simulation.pcbtransientchannelsimulation`, `simulation.pcbchannel` and
`simulation.ibismodel` elements rendered by the sibling core build. Public results
contain only receiver/quiet-driver waveforms and listed-leg total RLGC matrices.

The six supported cases passed native timestep and section convergence. All
transient solves were fresh; completed extraction requests were reused only when
their bytes matched exactly. Wall times below measure the runner through result
creation, before final evidence archiving, and include extraction-cache replay.

| Case | Capture (µs) | Native samples per waveform | Wall (s) | Maximum RMS delta (mV) | Maximum signed-extrema delta (mV) |
| --- | ---: | ---: | ---: | ---: | ---: |
| single | 7.2 | 1,580,521 | 400.664 | 1.54168 | 1.9867 |
| differential | 576 | 2,196,064 | 758.844 | 0.000188717 | 0.000174743 |
| two | 7.2 | 2,649,092 | 761.938 | 1.65273 | 4.79143 |
| three/TRAFFIC | 7.2 | 3,894,336 | 1939.218 | 1.69384 | 6.33039 |
| three/XTALK_LOW | 7.2 | 3,345,110 | 1450.878 | 1.39482 | 2.795 |
| three/XTALK_HIGH | 7.2 | 3,143,310 | 2177.713 | 1.47553 | 2.60305 |
| DDR3 write | — | 0 | 1.698 | — | — |

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
adaptive times, at the unchanged 1% + 1 mV limits. Quiet waveforms carry the
separately solved undisturbed idle voltage. `pdn="ideal"` constrains die rails and
retains scalar package R/L/C on signal, power and ground pins. Each selected
model’s explicit pullup, pulldown and clamp reference voltages override its
corner defaults; conflicting shared references fail. Extracted PDN,
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
The image generator checks each accepted physical board against the freshly
rendered TSX and records output hashes in
`tests/evidence/signal-levels/rfc-boards.json`. The final source is also replayed
against every exact native request using the original core-assigned record IDs;
unchanged waveform and RLGC bytes are recorded
in `tests/evidence/signal-levels/request-identity.json`, with zero new native calls.
Acquisition checkout heads record Git HEAD while working edits were present;
request hashes and final-source replay establish the exact simulation identity.

This remains a draft until the sibling dependencies are published. GitHub CI at
the first implementation push failed because the published circuit-json version
lacks the shared RFC schemas; local checks use the listed sibling builds. The CLI
call boundary is unchanged, but its extra aggregate JSON write must use the
pipeline’s indexed result parts when the full result exceeds V8’s string limit.

Local validation with the listed sibling overlays passed lint (one existing mesh
file-length warning), module checks, vocabulary (88.2%), source/test/example
typechecks, script typechecks, and `npm test`: 219 passed, three optional tests
skipped, zero failed. All five PNGs were visually inspected.
