# TSX example boards

Each level is an ordinary tscircuit board with `<simulation.pcbtransientchannelsimulation>`
blocks; it is an input to `RoutedPipelineSolver`. No simulation output is committed.

| Board | Signal-integrity blocks |
|---|---|
| `level1-single-ended` | one 20 Mbps single-ended DATA channel |
| `level1-differential` | one 250 kbps RS-485 BUS pair with a placed 120 Ω termination |
| `level2-two-channels` | two coupled 20 Mbps channels in one block |
| `level3-three-channels` | TRAFFIC, XTALK_LOW and XTALK_HIGH blocks over three channels |
| `level4-ddr3-write` | the AM3352 DDR3 lower-byte write; see [its README](level4-ddr3-write/README.md) |

[Routed stage examples](routed/README.md) describe the local runners and stage renders.
