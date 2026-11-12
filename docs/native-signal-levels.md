# Native PCB transient channel evidence

This draft follows RFC #29 at `9adc0fe`. The examples now use the actual
`simulation.pcbtransientchannelsimulation`, `simulation.pcbchannel` and
`simulation.ibismodel` elements rendered by the sibling core build. Public results
contain only receiver/quiet-driver waveforms and listed-leg total RLGC matrices.

The six supported cases passed native timestep and section convergence. At acquisition, all
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

At that acquisition, the exact DDR3 stop was `.CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.`
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
separately solved undisturbed idle voltage. Ideal die rails are always used; the pipeline
retains scalar package R/L/C on signal, power and ground pins. Each selected
model’s explicit pullup, pulldown and clamp reference voltages override its
typical values; conflicting shared references fail. Branched routed graphs retain
explicit errors. Coupled packages now have
[parser, passivity and circuit support](coupled-package-model.md), independently
verified without rerunning these native board cases. The updated core renders
all nine DDR3 channels. Unlisted E5/A1 reference pins now follow the IBIS scalar
hierarchy, while raw AM335x capacitance still violates the required Maxwell signs.
An opt-in in-memory sign diagnostic passes package admission and static assembly,
then reaches the switching-waveform overlap error. This is conditional evidence,
not raw-source acceptance. No new DDR3 waveforms or board-native evidence are claimed.

## Reproduction

Build circuit-json `fc6d402`, props `045186a` and core `8ec1af1` and use their local,
ignored dependency overlays. Vendor IBIS bytes stay under ignored `models/`.

```sh
export OMP_NUM_THREADS=1 IBIS_MODEL_DIR=models
export SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js"
export TSX_TSCONFIG_PATH=examples/tsconfig.json
export NGSPICE_BIN=/opt/homebrew/bin/ngspice
export SI_EXTRACTION_CACHE=/path/to/accepted-native-backup
export SI_REPLAY_COMPLETE_NATIVE=1 SI_REQUIRE_COMPLETE_CACHE=1
node --max-old-space-size=6000 --import tsx scripts/run-signal-levels.tsx
node --max-old-space-size=6000 --import tsx scripts/render-example-images.tsx
```

The runner checks memory before each uncached native process and refuses overlap.
Cases and blocks run sequentially. The per-process timeout is 1200000 ms; it is a
runner setting, not an acceptance limit. `SI_EXTRACTION_CACHE` accepts colon-separated
local evidence directories; `SI_REPLAY_COMPLETE_NATIVE=1` permits reuse only of
byte-identical completed native requests. With `SI_REQUIRE_COMPLETE_CACHE=1`, a cache miss stops the run before any native process starts. Replay notes record exact request matches while retaining acquisition timings.

Full accepted waveforms and exact native requests/logs are losslessly archived in
ignored `runs/final-rfc/`. Committed evidence contains hashes, convergence history
and provenance; no vendor bytes or solver decks are redistributed. Example CSVs
use only actual native samples and are decimated only when the full long-format
file exceeds 10 MB. The generation command and outcomes are in `examples/README.md`.
The image generator checks each accepted physical board against the freshly
rendered TSX and records output hashes in
`tests/evidence/signal-levels/rfc-boards.json`. The final source is also replayed
against every exact native request using the original core-assigned record IDs;
unchanged voltage/time arrays and RLGC matrices (with updated record fields) are recorded
in `tests/evidence/signal-levels/request-identity.json`, with zero new native calls.
Acquisition checkout heads record Git HEAD while working edits were present;
request hashes and final-source replay establish the exact simulation identity.

This remains a draft until the sibling dependencies are published. GitHub CI at
the first implementation push failed because the published circuit-json version
lacks the shared RFC schemas; local checks use the listed sibling builds. The CLI
call boundary is unchanged, but its extra aggregate JSON write must use the
pipeline’s indexed result parts when the full result exceeds V8’s string limit.

The no-enums refactor is verified by sequential cache-only example replay. Local validation passed typecheck, lint (one existing mesh file-length warning), module checks, vocabulary (88.4%), and `npm test`: 218 passed, three optional skips, zero failures. The final test invocation used `NODE_OPTIONS='--test-skip-pattern=^native.(single-ended|lossless-limit)'` to exclude the two solver tests. An initial invocation placed that option after the test paths, where Node ignored it; the small native buffer test ran before the invocation was corrected. Example replays launched no native processes.
