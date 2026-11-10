import { simulation } from "@tscircuit/core"
import { cpuFootprint, dramFootprint } from "../ddr3-parts"
import { routes } from "./routes"
/* LEVEL 4: AM3352 -> W631GG6MB-12 DDR3 lower-byte write illustration, not JEDEC compliance.
 * Currently stops with: .CPU: coupled [Package Model] not implemented yet; scalar fallback is forbidden.
 * Typical corner is 1.5 V. DQS is delayed 0.5 UI to centre-align write stimulus.
 * Exact native source footprint coordinates (CPU 0.4 mm pads, DRAM 0.350012 mm pads).
 * Source byte-lane swaps are retained; pin labels still identify actual IBIS [Pin] signals.
 * Eight-layer 1.2 mm board; JLC preset is illustrative, not a qualified source stackup.
 * pinLabels keys are physical balls; DQSL_N aliases DQSL#.
 * Only this byte lane and representative ideal rail balls are labelled/wired;
 * unused balls retain coordinates. Address/command, the upper byte and boot circuitry are omitted.
 */
// CPU D0..7 connect to DRAM DQL2,6,0,4,3,7,1,5 in the source board.
const dramBitOrder = [2, 6, 0, 4, 3, 7, 1, 5]
const cpuDq = ["M3", "M4", "N1", "N2", "N3", "N4", "P3", "P4"]
const dramDq = ["E3", "F7", "F2", "F8", "H3", "H8", "G2", "H7"]
const cpuPins = {
  ...Object.fromEntries(cpuDq.map((ball, i) => [ball, `DDR_D${i}`])),
  P1: "DDR_DQS0",
  P2: "DDR_DQSN0",
  E5: "VDDS_DDR",
  A1: "VSS",
}
const dramPins = {
  ...Object.fromEntries(dramDq.map((ball, i) => [ball, `DQL${i}`])),
  F3: "DQSL",
  G3: "DQSL_N",
  A1: "VDDQ",
  B1: "VSSQ",
}
const references = (balls: string[], high: string, low: string) =>
  Object.fromEntries(
    balls.map((ball) => [
      ball,
      { pullup: high, pulldown: low, powerClamp: high, groundClamp: low },
    ]),
  )

const route = (key: string) => ({
  pcbPathRelativeTo: routes[key].anchor,
  thickness: routes[key].width,
  pcbPaths: routes[key].paths.map((path) =>
    path.map(([x, y, fromLayer, toLayer]) =>
      toLayer ? { x, y, via: true, fromLayer, toLayer } : { x, y },
    ),
  ),
})

export default () => (
  <board pcbStyle={{viaHoleDiameter:0.15,viaPadDiameter:0.3}}
    width="40mm"
    height="50mm"
    outlineOffsetY={-13}
    layers={8}
    thickness={1.2}
    routeRemaining={false}
    allowBlindAndBuriedVias
    isViaInPadAllowed
    minTraceWidth={0.1}
    minViaHoleDiameter={0.15}
    minViaPadDiameter={0.3}
    minTraceToPadEdgeClearance={0.1}
    minPadEdgeToPadEdgeClearance={0.1}
    fabricatorPreset="jlcpcb_standard"
  >
    <chip
      name="CPU"
      manufacturerPartNumber="AM3352BZCZ100"
      pcbX={0}
      footprint={cpuFootprint}
      pinLabels={cpuPins}
    />
    <chip
      name="DRAM"
      manufacturerPartNumber="W631GG6MB-12"
      pcbX={0}
      pcbY={-27}
      footprint={dramFootprint}
      pinLabels={dramPins}
    />
    <simulation.ibismodel
      componentRef=".CPU"
      ibisModelAsset={{
        project_relative_path: "models/sprm552c.ibs",
        url: "./models/sprm552c.ibs",
        mimetype: "text/plain",
      }}
      ibisComponentName="am335x_zcz"
      ibisPinNameToPortLabel={cpuPins}
      ibisPinNameToModelName={Object.fromEntries(
        cpuDq.map((ball) => [ball, "Model_257"]),
      )}
      ibisPinNameToReferencePortLabels={references(
        [...cpuDq, "P1", "P2"],
        "VDDS_DDR",
        "VSS",
      )}
    />
    <simulation.ibismodel
      componentRef=".DRAM"
      ibisModelAsset={{
        project_relative_path: "models/W631GG6MB-12.ibs",
        url: "./models/W631GG6MB-12.ibs",
        mimetype: "text/plain",
      }}
      ibisComponentName="W631GG6MB-12"
      ibisPinNameToPortLabel={dramPins}
      ibisPinNameToModelName={Object.fromEntries(
        dramDq.map((ball) => [ball, "ODT_off"]),
      )}
      ibisPinNameToReferencePortLabels={references(
        [...dramDq, "F3", "G3"],
        "VDDQ",
        "VSSQ",
      )}
    />
    <trace {...route("CPU_VDDQ")} from=".CPU > .VDDS_DDR" to="net.VDDQ" />
    <trace {...route("DRAM_VDDQ")} from=".DRAM > .VDDQ" to="net.VDDQ" />
    <trace {...route("CPU_GND")} from=".CPU > .VSS" to="net.GND" />
    <trace {...route("DRAM_GND")} from=".DRAM > .VSSQ" to="net.GND" />
    {cpuDq.map((_, i) => (
      <trace key={String(i)} {...route(`DQ${i}`)} from={`.CPU > .DDR_D${i}`} to={`.DRAM > .DQL${dramBitOrder[i]}`} />
    ))}
    <trace {...route("DQS_P")} from=".CPU > .DDR_DQS0" to=".DRAM > .DQSL" />
    <trace {...route("DQS_N")} from=".CPU > .DDR_DQSN0" to=".DRAM > .DQSL_N" />
    <differentialpair
      positiveConnection=".CPU > .DDR_DQS0"
      negativeConnection=".CPU > .DDR_DQSN0"
    />
    <copperpour connectsTo="net.GND" layer="inner1" unbroken />
    {/* Ideal shared rail for the two representative VDDQ balls; source power network omitted. */}
    <copperpour connectsTo="net.VDDQ" layer="inner5" unbroken />

    <simulation.pcbtransientchannelsimulation name="WRITE" bitRate="800Mbps" corner="typical">
      <simulation.pcbchannel
        name="DQS"
        driverRef={{
          pin: { p: ".CPU > .DDR_DQS0", n: ".CPU > .DDR_DQSN0" },
          model: { p: "Model_579", n: "Model_771" },
        }}
        receiverRef={{
          pin: { p: ".DRAM > .DQSL", n: ".DRAM > .DQSL_N" },
          model: { p: "ODT_off", n: "ODT_off" },
        }}
        pattern="clock"
        offset="0.5UI"
      />
      {cpuDq.map((_, i) => (
        <simulation.pcbchannel
          key={String(i)}
          name={`DQ${i}`}
          driverRef={{ pin: `.CPU > .DDR_D${i}`, model: "Model_257" }}
          receiverRef={{ pin: `.DRAM > .DQL${dramBitOrder[i]}`, model: "ODT_off" }}
        />
      ))}
    </simulation.pcbtransientchannelsimulation>
  </board>
)
