import ballMap from "./am3352-ballmap.json";
import { pinLabels as ramPins } from "../components/ddr3";
export const ramNet = (s: string): string | undefined => {
  if (/^VSS/.test(s)) return "GND";
  if (/^VDD/.test(s)) return "DDR_1V5";
  if (/^VREF/.test(s)) return "DDR_VREF";
  if (/^DQL\d/.test(s)) return `DDR_D${s.slice(3)}`;
  if (/^DQU\d/.test(s)) return `DDR_D${8 + Number(s.slice(3))}`;
  if (/^A\d+$/.test(s) || /^BA\d/.test(s)) return `DDR_${s}`;
  return (
    {
      ODT: "DDR_ODT",
      CKE: "DDR_CKE",
      CK: "DDR_CK",
      N_CK: "DDR_CKn",
      N_CS: "DDR_CSn0",
      N_RESET: "DDR_RESETn",
      N_RAS: "DDR_RASn",
      N_CAS: "DDR_CASn",
      N_WE: "DDR_WEn",
      DML: "DDR_DQM0",
      DMU: "DDR_DQM1",
      DQSL: "DDR_DQS0",
      N_DQSl: "DDR_DQSn0",
      DQSU: "DDR_DQS1",
      N_DQSU: "DDR_DQSn1",
      ZQ: "DDR_ZQ",
    } as Record<string, string>
  )[s];
};

// Keep only original nets shared by the two retained chips.
const cpuNet = (signal: string) => {
  if (/^VSS/.test(signal) || ["VREFN", "RTC_KALDO_ENn", "VPP"].includes(signal))
    return "GND";
  if (signal === "VDDS_DDR") return "DDR_1V5";
  return signal;
};
export const cpuConnections = Object.entries(ballMap).map(([pin, signal]) => ({
  pin,
  net: cpuNet(signal),
}));
export const ramConnections = Object.entries(ramPins).map(([pin, labels]) => ({
  pin,
  net: ramNet(labels[1] ?? ""),
}));
export const sharedNets = [
  ...new Set(
    ramConnections.flatMap(({ net }) =>
      net &&
      !["GND", "DDR_1V5", "DDR_VREF"].includes(net) &&
      cpuConnections.some((c) => c.net === net)
        ? [net]
        : [],
    ),
  ),
];
