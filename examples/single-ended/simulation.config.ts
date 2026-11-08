import boardConstruction from "./board-construction.json"
import sourceProvenance from "../vendor-models.lock.json"

export const modeling = {
  ibisModelAssetSha256: { [`models/${sourceProvenance.models.cmos.file}`]: sourceProvenance.models.cmos.sha256 },
  lanes: [{ port: "DATA", from: { component: "TX", port: "Y" }, to: { component: "RX", port: "A" } }],

  boardConstruction, sourceProvenance,
  description: "Designed SN74LVC1G04 CMOS output-pad to input-pad board, explicit 20-Mbps data",
}
