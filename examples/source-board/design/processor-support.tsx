import {ramPoint,ramPlacement,isRamRef} from "./ram-placement";
import { Fragment } from "react";
import ballMap from "./am3352-ballmap.json";
import decouplingPlacement from "./decoupling-placement.json";
import { TPS65217CRSLR } from "../components/pmic";
import { TF_01A } from "../components/microsd";
import { Cap as BasicCap, Res, link } from "./nets";
import { ramNet, ramConnections } from "./ddr-netlist";
function Cap(props: {
  name: string;
  net: string;
  value?: string;
  x?: number;
  y?: number;
  bottom?: boolean;
  rotation?: number;
}) {
  const placed = props.bottom
    ? (
        decouplingPlacement as Record<
          string,
          { x: number; y: number; rotation: number }
        >
      )[props.name]
    : undefined;
  if (props.bottom && !placed)
    throw Error(`Missing decoupler placement: ${props.name}`);
  const position={x:placed?.x ?? props.x ?? 0,y:placed?.y ?? props.y ?? 0};
  const physical=isRamRef(props.name)?ramPoint(position.x,position.y):position;
  return (
    <BasicCap
      {...props}
      x={physical.x}
      y={physical.y}
      rotation={(placed?.rotation ?? props.rotation ?? 0)+(isRamRef(props.name)?ramPlacement.rotation:0)}
      layer={props.bottom ? "bottom" : "top"}
    />
  );
}
const cpuPower = (s: string): string | undefined => {
  if (/^VSS/.test(s)) return "GND";
  if (s === "VDD_MPU_MON") return "VDD_MPU";
  if (s === "VDD_CORE" || s === "VDD_MPU") return s;
  if (s === "VDDS_DDR") return "DDR_1V5";
  if (s === "VDDS_RTC") return "RTC_1V8";
  if (/^VDDSHV/.test(s)) return "V3V3";
  if (/^VDDA3P3/.test(s)) return "A3V3";
  if (
    s === "VDDS" ||
    /^VDDS_(PLL|OSC|SRAM)/.test(s) ||
    /^VDDA1P8/.test(s) ||
    s === "VDDA_ADC"
  )
    return "V1V8";
};
const cpuSignal = (s: string) =>
  cpuPower(s) ??
  {
    VREFN: "GND",
    VREFP: "V1V8",
    RTC_KALDO_ENn: "GND",
    VPP: "GND",
    RTC_PWRONRSTn: "RTC_RESETn",
  }[s] ??
  s;
const usedSignals = new Set([
  "DDR_VREF",
  "DDR_VTP",
  "I2C0_SDA",
  "I2C0_SCL",
  "UART0_TXD",
  "UART0_RXD",
  "TCK",
  "TMS",
  "TDI",
  "TDO",
  "TRSTn",
  "EMU0",
  "EMU1",
  "PWRONRSTn",
  "WARMRSTn",
  "RTC_PWRONRSTn",
  "RTC_KALDO_ENn",
  "PMIC_POWER_EN",
  "VPP",
  "XTALIN",
  "XTALOUT",
  "RTC_XTALIN",
  "RTC_XTALOUT",
  "VREFN",
  "VREFP",
  "MMC0_CLK",
  "MMC0_CMD",
  ...Array.from({ length: 4 }, (_, i) => `MMC0_DAT${i}`),
  // RGB uses SPI0_D0 as MOSI; Linux requires ti,pindir-d0-out-d1-in.
  // No SPI flash or external clock/input is fitted.
  "SPI0_D0",
  "USB0_VBUS",
  "USB1_VBUS",
  "USB0_DRVVBUS",
  "USB1_DRVVBUS",
  "CAP_VDD_RTC",
  "CAP_VDD_SRAM_CORE",
  "CAP_VDD_SRAM_MPU",
  "CAP_VBB_MPU",
]);
const powerPins: Record<string, string> = {
  AC: "VIN_5V",
  SYS1: "SYS_5V",
  SYS2: "SYS_5V",
  VIN_DCDC1: "SYS_5V",
  VIN_DCDC2: "SYS_5V",
  VIN_DCDC3: "SYS_5V",
  VINLDO: "SYS_5V",
  LS1_IN: "SYS_5V",
  LS2_IN: "SYS_5V",
  VLDO1: "RTC_1V8",
  VLDO2: "A3V3",
  LS1_OUT: "V1V8",
  LS2_OUT: "V3V3",
  VDCDC1: "DDR_1V5",
  VDCDC2: "VDD_MPU",
  VDCDC3: "VDD_CORE",
  PWR_EN: "PMIC_POWER_EN",
  PGOOD: "PWRONRSTn",
  nRESET: "RTC_RESETn",
  SDA: "I2C0_SDA",
  SCL: "I2C0_SCL",
  VIO: "V3V3",
  PGND: "GND",
  AGND: "GND",
  EP: "GND",
  TS: "PMIC_TS",
  INT_LDO: "PMIC_INT_LDO",
  BYPASS: "PMIC_BYPASS",
  PB_IN: "PMIC_PB",
  USB: "GND",
};
export function ProcessorSupport() {
  const supplies = Object.entries(ballMap).filter(
    ([, s]) => cpuPower(s) && cpuPower(s) !== "GND" && s !== "VDD_MPU_MON",
  );
  return (
    <>
      <TPS65217CRSLR name="U2" pcbX={-23} pcbY={-3} />
      {link("U1", "G2", "DDR_RESETn")}
      <TF_01A name="J_SD" pcbX={-23} pcbY={33} pcbRotation={180} />
      {Object.entries(ballMap)
        .filter(([, s]) => cpuPower(s) || usedSignals.has(s))
        .map(([ball, s]) => link("U1", ball, cpuSignal(s)))}
      {Object.entries(powerPins).map(([pin, net]) => link("U2", pin, net))}
      {ramConnections
        .filter(
          ({ net }) =>
            net && ["GND", "DDR_1V5", "DDR_VREF", "DDR_ZQ"].includes(net),
        )
        .map(({ pin, net }) => link("U3", pin, net!))}
      {[
        "MMC0_DAT2",
        "MMC0_DAT3",
        "MMC0_CMD",
        "V3V3",
        "MMC0_CLK",
        "GND",
        "MMC0_DAT0",
        "MMC0_DAT1",
        "SD_CD",
        "GND",
        "GND",
        "GND",
        "GND",
      ].map((n, i) => link("J_SD", `pin${i + 1}`, n))}
      {supplies.map(([ball, s], i) => (
        <Cap key={ball} name={`C_U1_${ball}`} net={cpuPower(s)!} bottom />
      ))}
      {["DDR_1V5", "VDD_MPU", "VDD_CORE"].map((rail, i) => (
        <Fragment key={rail}>
          <inductor
            name={`L${i + 1}`}
            manufacturerPartNumber="DFE201612E-2R2M=P2"
            inductance="2.2uH"
            footprint={
              <footprint>
                {[-1, 1].map((sign, j) => (
                  <smtpad
                    portHints={[`pin${j + 1}`]}
                    shape="rect"
                    pcbX={sign * 0.8}
                    pcbY={0}
                    width={0.8}
                    height={1.8}
                  />
                ))}
                <courtyardrect pcbX={0} pcbY={0} width={2.9} height={2.3} />
              </footprint>
            }
            pcbX={[-17.5, -17.5, -23.2][i]}
            pcbY={[-3.5, 0.5, 2.6][i]}
            pcbRotation={i === 2 ? 90 : 0}
          />
          {link("U2", `L${i + 1}`, `SW${i + 1}`)}
          {link(`L${i + 1}`, "pin1", `SW${i + 1}`)}
          {link(`L${i + 1}`, "pin2", rail)}
          <Cap
            name={`C_DCDC${i + 1}`}
            net={rail}
            value="22uF"
            x={[-17.5, -17.5, -19.7][i]}
            y={[-6.1, 3.1, 5.4][i]}
          />
        </Fragment>
      ))}
      {[
        "VIN_5V",
        "SYS_5V",
        "RTC_1V8",
        "A3V3",
        "V1V8",
        "V3V3",
        "PMIC_BYPASS",
        "PMIC_INT_LDO",
      ].map((n, i) => (
        <Cap
          key={n}
          name={`C_P${i}`}
          net={n}
          value={n === "PMIC_INT_LDO" ? "100nF" : "4.7uF"}
          x={[-20.8, -26.1, -24.4, -28, -28.6, -28.6, -28.6, -31.7][i]}
          y={[-8.4, 2, -8.4, -8.4, -0.8, -3.2, -5.6, -4.4][i]}
          rotation={i === 1 || i >= 3 ? 180 : 0}
        />
      ))}
      {Array.from({ length: 16 }, (_, i) => (
        <Cap key={i} name={`C_DDR${i}`} net="DDR_1V5" bottom />
      ))}
      <Res name="R_VREF_H" a="DDR_1V5" b="DDR_VREF" value="10k" {...ramPoint(-7,-29)} rotation={ramPlacement.rotation} />
      <Res name="R_VREF_L" a="DDR_VREF" b="GND" value="10k" {...ramPoint(-6.50000000,-29.70000000)} layer="bottom" rotation={(ramPlacement.rotation + 90) % 360} />
      <Cap name="C_VREF" net="DDR_VREF" x={6} y={-33} />
      <Res name="R_ZQ" a="DDR_ZQ" b="GND" value="240" {...ramPoint(6,-29)} rotation={ramPlacement.rotation} />
      <Res
        name="R_VTP"
        a="DDR_VTP"
        b="GND"
        value="49.9"
        x={1.51}
        y={-3.8}
        layer="bottom"
      />
      <Res name="R_DDR_RST" a="DDR_RESETn" b="GND" value="10k" {...ramPoint(7,-36)} rotation={ramPlacement.rotation} />
      {[
        "I2C0_SDA",
        "I2C0_SCL",
        "PWRONRSTn",
        "WARMRSTn",
        "TRSTn",
        "EMU0",
        "EMU1",
      ].map((n, i) => (
        <Res
          key={n}
          name={`R_CTRL${i}`}
          a={n}
          b="V3V3"
          value={i < 2 ? "4.7k" : "10k"}
          x={-17 + i * 3}
          y={13}
        />
      ))}
      <Res name="R_RTC_RST" a="RTC_RESETn" b="RTC_1V8" x={-20} y={8} />
      <Res name="R_TS" a="PMIC_TS" b="GND" value="10k" x={-18} y={-8.5} />
      {[
        "CAP_VDD_RTC",
        "CAP_VDD_SRAM_CORE",
        "CAP_VDD_SRAM_MPU",
        "CAP_VBB_MPU",
      ].map((n, i) => (
        <Cap
          key={n}
          name={`C_CAP${i}`}
          net={n}
          value="1uF"
          x={i === 1 || i === 2 ? -14.25 : -13}
          y={-6 + i * 3}
        />
      ))}
      <crystal
        name="Y1"
        manufacturerPartNumber="ABM3-24.000MHZ-D2Y-T"
        frequency="24MHz"
        loadCapacitance="18pF"
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              shape="rect"
              width={1.9}
              height={2.4}
              pcbX={-2.05}
            />
            <smtpad
              portHints={["pin2"]}
              shape="rect"
              width={1.9}
              height={2.4}
              pcbX={2.05}
            />
            <courtyardrect pcbX={0} pcbY={0} width={6.5} height={3.9} />
            <silkscreenrect pcbX={0} pcbY={0} width={5.8} height={3.4} />
          </footprint>
        }
        pcbX={12}
        pcbY={2.8}
        pcbRotation={180}
      />
      {link("Y1", "pin1", "XTALIN")}
      {link("Y1", "pin2", "XTALOUT")}
      <Cap name="C_X1" net="XTALIN" value="22pF" x={12} y={-0.15} rotation={270} />
      <Cap
        name="C_X2"
        net="XTALOUT"
        value="22pF"
        x={10.2}
        y={0.3}
        rotation={0}
      />
      {/* Epson FC-135: no circuit patterns between the two lands. */}
      <keepout
        shape="rect"
        pcbX={-11}
        pcbY={-2.8}
        width={1.8}
        height={1.5}
        layers={["top"]}
        allowPlacements
      />
      <crystal
        name="Y2"
        manufacturerPartNumber="Q13FC13500004"
        frequency="32.768kHz"
        loadCapacitance="12.5pF"
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              shape="rect"
              width={1}
              height={1.8}
              pcbX={-1.25}
            />
            <smtpad
              portHints={["pin2"]}
              shape="rect"
              width={1}
              height={1.8}
              pcbX={1.25}
            />
            <courtyardrect pcbX={0} pcbY={0} width={4} height={2.3} />
            <silkscreenrect pcbX={0} pcbY={0} width={3.8} height={2} />
          </footprint>
        }
        pcbX={-11}
        pcbY={-2.8}
        pcbRotation={270}
      />
      {link("Y2", "pin1", "RTC_XTALIN")}
      {link("Y2", "pin2", "RTC_XTALOUT")}
      <Cap
        name="C_RTCX1"
        net="RTC_XTALIN"
        value="18pF"
        x={-10}
        y={0}
        rotation={0}
      />
      <Cap
        name="C_RTCX2"
        net="RTC_XTALOUT"
        value="18pF"
        x={-10}
        y={-5.75}
        rotation={0}
      />
      {[
        "MMC0_CMD",
        "MMC0_DAT0",
        "MMC0_DAT1",
        "MMC0_DAT2",
        "MMC0_DAT3",
        "SD_CD",
      ].map((n, i) => (
        <Res
          key={n}
          name={`R_SD${i}`}
          a={n}
          b="V3V3"
          value="47k"
          x={-30 + i * 3}
          y={12}
        />
      ))}
      <Cap name="C_SD" net="V3V3" value="10uF" x={-7} y={16} />

      {/* TI SPRUH73Q Table 26-7: 24 MHz and MMC0 -> SPI0 -> UART0 -> USB0. */}
      {Array.from({ length: 16 }, (_, i) => (
        <Res
          key={i}
          name={`R_BOOT${i}`}
          a={`LCD_DATA${i}`}
          b={0x4017 & (1 << i) ? "V3V3" : "GND"}
          value="10k"
          x={-31 + (i % 8) * 3.5}
          y={18 + Math.floor(i / 8) * 4}
        />
      ))}
      {[16, 17].map((i) => (
        <Cap key={i} name={`C_DDR${i}`} net="DDR_1V5" bottom />
      ))}
      <Cap name="C_SYS_LOCAL" net="SYS_5V" value="4.7uF" x={-17.5} y={-1.5} />
      <pinheader name="J_UART" pinCount={4} pitch={2.54} pcbX={-8} pcbY={34} />
      {["GND", "UART0_TXD", "UART0_RXD", "V3V3"].map((n, i) =>
        link("J_UART", `pin${i + 1}`, n),
      )}
      <pinheader
        name="J_JTAG"
        pinCount={14}
        pcbX={2}
        pcbY={31}
        footprint={
          <footprint>
            {Array.from({ length: 14 }, (_, i) => (
              <platedhole
                portHints={[`pin${i + 1}`]}
                shape="circle"
                pcbX={((i % 2) - 0.5) * 1.27}
                pcbY={(Math.floor(i / 2) - 3) * 1.27}
                holeDiameter={0.6}
                outerDiameter={1}
              />
            ))}
          </footprint>
        }
      />
      {[
        "V3V3",
        "TMS",
        "GND",
        "TCK",
        "GND",
        "TDO",
        "GND",
        "TDI",
        "TRSTn",
        "GND",
        "EMU0",
        "EMU1",
        "WARMRSTn",
        "GND",
      ].map((n, i) => link("J_JTAG", `pin${i + 1}`, n))}
      <pinheader name="J_RESET" pinCount={2} pitch={2.54} pcbX={-31} pcbY={8} />
      {link("J_RESET", "pin1", "WARMRSTn")}
      {link("J_RESET", "pin2", "GND")}
      <testpoint
        name="TP_PB"
        footprintVariant="pad"
        padDiameter={1}
        pcbX={-30}
        pcbY={1}
      />
      {link("TP_PB", "pin1", "PMIC_PB")}
    </>
  );
}
