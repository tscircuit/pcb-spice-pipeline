import { CH224K } from "../components/CH224K";
import { TYPE_C_31_M_12 } from "../components/usb-c";
import { Cap, Res, link } from "./nets";

// Fixed 5 V request. CFG1=1 selects 5 V; CFG2/3 are don't-care.
// CH224K PG is open-drain, active LOW after successful voltage negotiation.
// This design requires a 5 V / 3 A PD source. PG alone does not certify 3 A.
export function PdPower() {
  return (
    <>
      <TYPE_C_31_M_12
        name="J_PD"
        pcbX={-46}
        pcbY={0}
        pcbRotation={270}
        noConnect={["SBU1", "SBU2", "DP1", "DP2", "DM1", "DM2"]}
      />
      <CH224K name="U_PD" pcbX={-35} pcbY={1} noConnect={["DP", "DM"]} />
      {["VBUS1", "VBUS2"].map((p) => link("J_PD", p, "PD_VBUS"))}
      {["GND1", "GND2", "SHELL1", "SHELL2", "SHELL3", "SHELL4"].map((p) =>
        link("J_PD", p, "GND"),
      )}
      {link("J_PD", "CC1", "PD_CC1")}
      {link("J_PD", "CC2", "PD_CC2")}
      {link("U_PD", "CC1", "PD_CC1")}
      {link("U_PD", "CC2", "PD_CC2")}
      {link("U_PD", "GND", "GND")}
      {link("U_PD", "VDD", "PD_VDD")}
      {link("U_PD", "VBUS", "PD_SENSE")}
      {link("U_PD", "CFG1", "PD_VDD")}
      {link("U_PD", "CFG2", "GND")}
      {link("U_PD", "CFG3", "GND")}
      {link("U_PD", "PG", "PD_PGn")}
      <Res name="R_PD_VDD" a="PD_VBUS" b="PD_VDD" value="1k" x={-40} y={-6} />
      <Res
        name="R_PD_SENSE"
        a="PD_VBUS"
        b="PD_SENSE"
        value="10k"
        x={-37}
        y={-6}
      />
      <Cap name="C_PD_VDD" net="PD_VDD" value="1uF" x={-40} y={-9} />
      <Cap name="C_PD_IN" net="PD_VBUS" value="1uF" x={-44} y={-7} />
      <chip
        name="Q_PD"
        manufacturerPartNumber="AO3401A"
        footprint="sot23"
        pinLabels={{ pin1: "G", pin2: "S", pin3: "D" }}
        pcbX={-38}
        pcbY={-14}
      />
      {link("Q_PD", "S", "PD_VBUS")}
      {link("Q_PD", "D", "VIN_5V")}
      {link("Q_PD", "G", "PD_GATE")}
      <Res
        name="R_PD_GATE"
        a="PD_GATE"
        b="PD_PGn"
        value="10k"
        x={-34}
        y={-10}
      />
      <Res
        name="R_PD_OFF"
        a="PD_GATE"
        b="PD_VBUS"
        value="100k"
        x={-34}
        y={-13}
      />
      <Cap name="C_PD_OUT" net="VIN_5V" value="10uF" x={-38} y={-18} />
      <testpoint
        name="TP_5V"
        footprintVariant="pad"
        padDiameter={1.5}
        pcbX={-33}
        pcbY={-18}
      />
      {link("TP_5V", "pin1", "VIN_5V")}
      <silkscreentext
        text="USB-C PD / 5V 3A"
        pcbX={-38}
        pcbY={10}
        fontSize={0.8}
      />
    </>
  );
}
