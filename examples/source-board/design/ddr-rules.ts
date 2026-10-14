import { sharedNets } from "./ddr-netlist";

/** TI AM335x SPRS717L, Tables 7-62 and 7-66 through 7-69.
 * PCB geometric limits, not package-delay or SI signoff.
 * One x16 memory, point-to-point topology (Figure 7-48).
 */
export const DDR_RULES = {
  source: "https://www.ti.com/lit/ds/symlink/am3352.pdf",
  revision: "SPRS717L",
  signalLayers: ["inner1", "inner2"] as const,
  byteSkewMm: 0.635,
  addressClockSkewMm: 0.635, // 25 mil A1+A2 skew, conservative for one load
  pairSkewMm: 0.127,
  caManhattanAllowanceMm: 7.62, // 300 mil
  caNominalToleranceMm: 1.27, // 50 mil
  caMaximumLengthMm: 63.5, // 2500 mil A1+A2
  singleEndedImpedanceOhm: 50,
  differentialImpedanceOhm: 100,
  // Width/gap remain provisional until a fabricator stackup is specified.
  provisionalTraceWidthMm: 0.1,
  provisionalPairGapMm: 0.12,
};
export const ddrByteSignals = (byte: number) => [
  ...Array.from({ length: 8 }, (_, bit) => `DDR_D${byte * 8 + bit}`),
  `DDR_DQM${byte}`, `DDR_DQS${byte}`, `DDR_DQSn${byte}`,
];
export const ddrClockSignals = ["DDR_CK", "DDR_CKn"];
export const ddrAddressControlSignals = sharedNets.filter((name) =>
  /^DDR_(A\d+|BA[012]|CSn0|CASn|RASn|WEn|CKE|ODT)$/.test(name),
);
export const ddrTimingGroups = [
  ...[0, 1].map((byte) => ({
    name: `DDR_BYTE${byte}`,
    signals: ddrByteSignals(byte),
    maxLengthSkew: DDR_RULES.byteSkewMm,
  })),
  {
    name: "DDR_ADDR_CTRL_CK",
    signals: [...ddrAddressControlSignals, ...ddrClockSignals],
    maxLengthSkew: DDR_RULES.addressClockSkewMm,
  },
];
export const ddrPairs = [
  { name: "DDR_DQS_PAIR0", signals: ["DDR_DQS0", "DDR_DQSn0"] },
  { name: "DDR_DQS_PAIR1", signals: ["DDR_DQS1", "DDR_DQSn1"] },
  { name: "DDR_CK_PAIR", signals: ddrClockSignals },
];
export const ddrTraceName = (signal: string) =>
  signal === "DDR_RESETn" ? "DDR_RESETn_SIGNAL" : signal;
