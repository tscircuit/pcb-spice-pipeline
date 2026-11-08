import boardConstruction from "./board-construction.json"
import sourceProvenance from "../vendor-models.lock.json"

export const modeling = {
  ibisModelAssetSha256: { [`models/${sourceProvenance.models.rs485.file}`]: sourceProvenance.models.rs485.sha256 },
  lanes: [
    { port: "A", from: { component: "TX", port: "A" }, to: { component: "RX", port: "A" } },
    { port: "B", from: { component: "TX", port: "B" }, to: { component: "RX", port: "B" } },
  ],

  passiveComponents: [{ component: "RTERM" }],
  boardConstruction, sourceProvenance,
  description: "Designed SN65HVD72 RS-485 pad/channel board, 250 kbps explicit data",
}
