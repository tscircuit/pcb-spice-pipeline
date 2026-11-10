// Preplaced copper. Numeric points use the anchor footprint frame; the
// 0.25 mm pitch trunks fan out around RX.
type PathPoint = string | { x: number; y: number }

export const routes: Record<string, PathPoint[]> = {
  TX_GND: [".TX > .GND", ".GND_TX > .top"],
  RX_GND: [".RX > .GND", ".GND_RX > .top"],
  A: [
    ".TX > .A", { x: 3.5, y: -0.635 }, { x: 4.01, y: -0.125 },
    { x: 41.75, y: -0.125 }, { x: 41.75, y: -3 },
    { x: 49.8, y: -3 }, { x: 49.8, y: -0.635 }, ".RX > .A",
  ],
  B: [
    ".TX > .B", { x: 3.5, y: 0.635 }, { x: 4.01, y: 0.125 },
    { x: 41.5, y: 0.125 }, { x: 41.5, y: 3 },
    { x: 49.8, y: 3 }, { x: 49.8, y: 0.635 }, ".RX > .B",
  ],
  A_TERM: [".RX > .A", ".RTERM > .pin1"],
  B_TERM: [".RX > .B", ".RTERM > .pin2"],
}
