import { Fragment } from "react";
import { AO3400A } from "../components/AO3400A";
import { SN74AHCT1G125DBVR } from "../components/SN74AHCT1G125DBVR";
import { TZ_0807Z1RGB_5V_I4_MS_5mA_ as RgbLed } from "../components/TZ_0807Z1RGB_5V_I4_MS_5mA_";
import { Cap, Res, link } from "./nets";

export function Indicators() {
  return (
    <>
      <SN74AHCT1G125DBVR name="U_RGB_BUF" pcbX={21} pcbY={7} />
      {link("U_RGB_BUF", "pin1", "GND")}
      {link("U_RGB_BUF", "pin2", "SPI0_D0")}
      {link("U_RGB_BUF", "pin3", "GND")}
      {link("U_RGB_BUF", "pin4", "RGB_BUFFERED")}
      {link("U_RGB_BUF", "pin5", "VIN_5V")}
      <Cap name="C_RGB_BUF" net="VIN_5V" x={21} y={4} />
      <Res name="R_RGB_IN" a="SPI0_D0" b="GND" value="100k" x={16} y={7} />
      <Res
        name="R_RGB_DATA"
        a="RGB_BUFFERED"
        b="RGB_DIN"
        value="330"
        x={25}
        y={7}
      />
      {[0, 1].map((i) => (
        <Fragment key={i}>
          <RgbLed name={`D_RGB${i}`} pcbX={31 + i * 7} pcbY={8} />
          {link(`D_RGB${i}`, "VDD", "VIN_5V")}
          {link(`D_RGB${i}`, "GND", "GND")}
          {link(`D_RGB${i}`, "DIN", i ? "RGB_CHAIN" : "RGB_DIN")}
          {i === 0 && link("D_RGB0", "DOU", "RGB_CHAIN")}
          <Cap name={`C_RGB${i}`} net="VIN_5V" x={31 + i * 7} y={5} />
        </Fragment>
      ))}
      <chip
        name="BZ1"
        manufacturerPartNumber="PS1240P02BT"
        pinLabels={{ pin1: "POS", pin2: "NEG" }}
        pcbX={-38}
        pcbY={-27}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              shape="circle"
              pcbX={-2.5}
              holeDiameter={0.8}
              outerDiameter={1.6}
            />
            <platedhole
              portHints={["pin2"]}
              shape="circle"
              pcbX={2.5}
              holeDiameter={0.8}
              outerDiameter={1.6}
            />
            <silkscreencircle radius={6.2} />
            <courtyardcircle radius={6.5} />
          </footprint>
        }
      />
      <AO3400A name="Q_BUZZ" pcbX={-28} pcbY={-28} />
      {link("BZ1", "POS", "V3V3")}
      {link("BZ1", "NEG", "BUZZ_DRAIN")}
      {link("Q_BUZZ", "D", "BUZZ_DRAIN")}
      {link("Q_BUZZ", "S", "GND")}
      {link("Q_BUZZ", "G", "BUZZ_GATE")}
      {link("U1", "C18", "BUZZ_PWM")}
      <Res
        name="R_BUZZ_GATE"
        a="BUZZ_PWM"
        b="BUZZ_GATE"
        value="100"
        x={-24}
        y={-28}
      />
      <Res
        name="R_BUZZ_OFF"
        a="BUZZ_GATE"
        b="GND"
        value="100k"
        x={-24}
        y={-31}
      />
      <Res
        name="R_BUZZ_BLEED"
        a="BUZZ_DRAIN"
        b="V3V3"
        value="10k"
        x={-30}
        y={-32}
      />
    </>
  );
}
