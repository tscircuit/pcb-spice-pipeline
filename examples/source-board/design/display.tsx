import { Fragment } from "react";
import { Tfp410 } from "../components/tfp410";
import { TPD12S521DBTR } from "../components/TPD12S521DBTR";
import { HDMI_001_19PCBTP } from "../components/HDMI_001_19PCBTP";
import { BLM18AG601SN1D } from "../components/BLM18AG601SN1D";
import { SignalTrace, Cap, Res, cpuPin, link } from "./nets";

// RGB565 expands into the most significant bits of TFP410's 24-bit input.
// TI SLDS145D: high-swing 3.3 V input requires VREF=DVDD (not a divider).
export function Display() {
  const dataPins = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 19, 20, 21, 22, 23];
  const pairs = [
    { id: "CK", out: "C", p: 10, n: 12 },
    { id: "D0", out: "0", p: 7, n: 9 },
    { id: "D1", out: "1", p: 4, n: 6 },
    { id: "D2", out: "2", p: 1, n: 3 },
  ];
  return (
    <>
      <Tfp410
        noConnect={["MSEN_PO1", "NC"]}
        name="U_HDMI"
        pcbX={22}
        pcbY={-16}
      />
      <TPD12S521DBTR
        noConnect={["CE_REMOTE_IN", "CE_REMOTE_OUT"]}
        internallyConnectedPins={pairs.flatMap(({ id }) => [
          [`TMDS_${id}_POS1`, `TMDS_${id}_POS2`],
          [`TMDS_${id}_NEG1`, `TMDS_${id}_NEG2`],
        ])}
        name="U_HDMI_ESD"
        pcbX={35}
        pcbY={-16}
        pcbRotation={270}
      />
      <HDMI_001_19PCBTP
        name="J_HDMI"
        pcbX={44}
        pcbY={-16}
        pcbRotation={90}
        noConnect={["pin13", "pin14"]}
      />
      {dataPins.map((pin, i) => (
        <Fragment key={i}>
          <SignalTrace
            name={`LCD_DATA${i}_SIGNAL`}
            from={cpuPin(`LCD_DATA${i}`)}
            to={`U_HDMI.DATA${pin}`}
            routingPhaseIndex={4}
          />
          {link("U_HDMI", `DATA${pin}`, `LCD_DATA${i}`)}
        </Fragment>
      ))}
      {[0, 1, 2, 8, 9, 16, 17, 18].map((p) =>
        link("U_HDMI", `DATA${p}`, "GND"),
      )}
      {[
        ["LCD_PCLK", "IDCK_P"],
        ["LCD_HSYNC", "HSYNC"],
        ["LCD_VSYNC", "VSYNC"],
        ["LCD_AC_BIAS_EN", "DE"],
      ].map(([signal, pin]) => (
        <SignalTrace
          key={signal}
          name={signal}
          from={cpuPin(signal)}
          to={`U_HDMI.${pin}`}
          routingPhaseIndex={4}
        />
      ))}
      {[
        "DGND_16",
        "DGND_48",
        "DGND_64",
        "PGND",
        "TGND_20",
        "TGND_26",
        "TGND_32",
        "THERMAL_PAD",
        "IDCK_N",
        "RESERVED",
        "DKEN",
        "ISEL_RST",
        "DSEL_SDA",
        "A3_DK3",
        "CTL2_A2_DK2",
        "CTL1_A1_DK1",
      ].map((p) => link("U_HDMI", p, "GND"))}
      {["DVDD_1", "DVDD_12", "DVDD_33", "VREF", "BSEL_SCL", "EDGE_HTPLG"].map(
        (p) => link("U_HDMI", p, "V3V3"),
      )}
      {link("U_HDMI", "PD", "PWRONRSTn")}
      {["TVDD_23", "TVDD_29"].map((p) => link("U_HDMI", p, "HDMI_TVDD"))}
      {link("U_HDMI", "PVDD", "HDMI_PVDD")}
      {link("U_HDMI", "TFADJ", "HDMI_TFADJ")}
      <Res
        name="R_TFADJ"
        a="HDMI_TFADJ"
        b="HDMI_TVDD"
        value="510"
        x={31}
        y={-24}
      />
      {["TVDD", "PVDD"].map((rail, i) => (
        <Fragment key={rail}>
          <BLM18AG601SN1D name={`FB_HDMI${i}`} pcbX={25 + i * 4} pcbY={-28} />
          {link(`FB_HDMI${i}`, "pin1", "V3V3")}
          {link(`FB_HDMI${i}`, "pin2", `HDMI_${rail}`)}
          <Cap
            name={`C_HDMI_BULK${i}`}
            net={`HDMI_${rail}`}
            value="1uF"
            x={25 + i * 4}
            y={-31}
          />
        </Fragment>
      ))}
      {[
        ["V3V3", 19, -24],
        ["V3V3", 24, -24],
        ["V3V3", 24, -8],
        ["HDMI_TVDD", 30, -7],
        ["HDMI_TVDD", 27, -7],
        ["HDMI_PVDD", 32, -26],
      ].map(([net, x, y], i) => (
        <Cap
          key={i}
          name={`C_HDMI${i}`}
          net={net as string}
          x={x as number}
          y={y as number}
        />
      ))}
      {pairs.map(({ id, out, p, n }) => (
        <Fragment key={id}>
          {[
            ["P", "POS", p],
            ["N", "NEG", n],
          ].map(([pol, word, jpin]) => (
            <Fragment key={pol}>
              <SignalTrace
                name={`TMDS_${id}_${pol}_TX`}
                from={`U_HDMI.TX${out}_${pol}`}
                to={`U_HDMI_ESD.TMDS_${id}_${word}1`}
                routingPhaseIndex={3}
              />
              <SignalTrace
                name={`TMDS_${id}_${pol}_PORT`}
                from={`U_HDMI_ESD.TMDS_${id}_${word}2`}
                to={`J_HDMI.pin${jpin}`}
                routingPhaseIndex={3}
              />
            </Fragment>
          ))}
          {["TX", "PORT"].map((segment) => (
            <differentialpair
              name={`TMDS_${id}_${segment}`}
              positiveConnection={`TMDS_${id}_P_${segment}`}
              negativeConnection={`TMDS_${id}_N_${segment}`}
              targetDifferentialImpedance="100ohm"
              maxLengthSkew={0.127}
              pcbTraceGap={0.18}
            />
          ))}
        </Fragment>
      ))}
      {[
        "GND1",
        "GND2",
        ...Array.from({ length: 8 }, (_, i) => `TMDS_GND${i + 1}`),
      ].map((p) => link("U_HDMI_ESD", p, "GND"))}
      {[2, 5, 8, 11, 17, 20, 21, 22, 23].map((p) =>
        link("J_HDMI", `pin${p}`, "GND"),
      )}
      {link("U_HDMI_ESD", "5V_SUPPLY", "VIN_5V")}
      {link("U_HDMI_ESD", "LV_SUPPLY", "V3V3")}
      {link("U_HDMI_ESD", "5V_OUT", "HDMI_5V")}
      {link("J_HDMI", "pin18", "HDMI_5V")}
      {link("U_HDMI_ESD", "DDC_CLK_IN", "I2C0_SCL")}
      {link("U_HDMI_ESD", "DDC_DAT_IN", "I2C0_SDA")}
      {link("U_HDMI_ESD", "DDC_CLK_OUT", "HDMI_SCL")}
      {link("J_HDMI", "pin15", "HDMI_SCL")}
      {link("U_HDMI_ESD", "DDC_DAT_OUT", "HDMI_SDA")}
      {link("J_HDMI", "pin16", "HDMI_SDA")}
      {link("U_HDMI_ESD", "HOTPLUG_DET_OUT", "HDMI_HPD_5V")}
      {link("J_HDMI", "pin19", "HDMI_HPD_5V")}
      {link("U_HDMI_ESD", "HOTPLUG_DET_IN", "HDMI_HPD")}
      {link("U1", "R13", "HDMI_HPD")}
      {link("U_HDMI_ESD", "ESD_BYP", "HDMI_ESD_BYP")}
      <Res
        name="R_HDMI_SCL"
        a="HDMI_SCL"
        b="HDMI_5V"
        value="1.7k"
        x={40}
        y={-25}
      />
      <Res
        name="R_HDMI_SDA"
        a="HDMI_SDA"
        b="HDMI_5V"
        value="1.7k"
        x={43}
        y={-25}
      />
      <Res name="R_HDMI_HPD" a="HDMI_HPD_5V" b="GND" x={43} y={-28} />
      <Res
        name="R_HDMI_HPD_LV"
        a="HDMI_HPD"
        b="V3V3"
        value="47k"
        x={37}
        y={-28}
      />
      <Cap name="C_HDMI_ESD" net="HDMI_ESD_BYP" x={36} y={-24} />
      <Cap name="C_HDMI_5V" net="HDMI_5V" x={40} y={-28} />
      <Cap name="C_HDMI_SUPPLY" net="VIN_5V" x={36} y={-8} />
      <Cap name="C_HDMI_LV" net="V3V3" x={37.5} y={-6} />
      <silkscreentext text="HDMI VIDEO" pcbX={41} pcbY={-4} fontSize={0.9} />
    </>
  );
}
