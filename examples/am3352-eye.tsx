import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { ibisModelProps, type BoardProps } from "@tscircuit/props"
import base from "./am3352.json" with { type: "json" }
import construction from "./am3352-construction.json" with { type: "json" }
import sourceProvenance from "./source-provenance.json" with { type: "json" }

// This is the complete published v0.1.19 board, with its existing routes.
// The historical source TSX is preserved under source-board/. No rerouting occurs.
const originalBytes = gunzipSync(readFileSync(new URL(base.circuit, import.meta.url)))
if (createHash("sha256").update(originalBytes).digest("hex") !== base.fixtureProvenance.originalJsonSha256)
  throw new Error("AM3352: the original published routed board snapshot changed")
const routedBoard: NonNullable<BoardProps["circuitJson"]> = JSON.parse(originalBytes.toString("utf8"))

const vendorConfig = (config: typeof base.driver | typeof base.receiver, index: number) => ibisModelProps.parse({
  ...config,
  sourceUrl: base.vendors[index].url,
  archivePath: base.vendors[index].archivePath,
  sha256: base.vendors[index].sha256,
})
const ti = vendorConfig(base.driver, 0)
const winbond = vendorConfig(base.receiver, 1)

export const modeling = {
  ...base,
  description: "Published AM3352 v0.1.19 DDR DQS paths, native IBIS/eyediagram; explicit reduced channel, engineering draft without DDR sign-off",
  requireNativeIbis: true,
  requireNativeEye: true,
  driver: {
    ...ti,
    pins: { P1: ti.pins.DQS, P2: ti.pins.DQSn },
    power: { vdd: "E5", vss: "A1" },
  },
  receiver: {
    ...winbond,
    pins: { F3: winbond.pins.DQS, G3: winbond.pins.DQSn },
    power: { vdd: "A1", vss: "B1" },
  },
  lanes: [
    { port: "DQS", driverPort: "P1", receiverPort: "F3", from: { component: "U1", port: "P1" }, to: { component: "U3", port: "F3" } },
    { port: "DQSn", driverPort: "P2", receiverPort: "G3", from: { component: "U1", port: "P2" }, to: { component: "U3", port: "G3" } },
  ],
  stackup: construction.copperLayers,
  boardConstruction: construction,
  sourceProvenance,
}

export function createBoard({
  duration = "100ns", positive = ".U3 > .F3", negative = ".U3 > .G3",
}: { duration?: string; positive?: string; negative?: string } = {}) {
  return (
    <board circuitJson={routedBoard} routingDisabled schematicDisabled
      simIbisModels={{ U1: modeling.driver, U3: modeling.receiver }}>
      <eyediagram name="DDR_DQS0" positive={positive} negative={negative}
        unitInterval="2.5ns" duration={duration} timeStep="10ps" startTime="20ns" />
    </board>
  )
}
export default createBoard
