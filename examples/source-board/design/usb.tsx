import { KS227M016E07RR0VH2FP0 as UsbBulkCap } from "../components/bulk-capacitor";
import { Fragment } from "react";
import { UsbA } from "../components/usb-a";
import { USBLC6_2SC6 } from "../components/usb-esd";
import { SignalTrace, Cap, Res, cpuPin, link } from "./nets";

export function UsbPorts() {
  return (
    <>
      {/* TI SLVS514P Table 5-2: active-high, independently limited host power. */}
      <chip
        name="U_USB_PWR"
        manufacturerPartNumber="TPS2052BDR"
        footprint="soic8"
        pcbX={24}
        pcbY={18}
        pinLabels={{
          pin1: "GND",
          pin2: "IN",
          pin3: "EN1",
          pin4: "EN2",
          pin5: "OC2",
          pin6: "OUT2",
          pin7: "OUT1",
          pin8: "OC1",
        }}
      />
      {link("U_USB_PWR", "IN", "VIN_5V")}
      {link("U_USB_PWR", "GND", "GND")}
      <Cap name="C_USB_PWR" net="VIN_5V" value="10uF" x={24} y={14} />
      {[0, 1].map((i) => (
        <Fragment key={i}>
          <UsbA
            name={`J_USB${i}`}
            pcbX={16 + i * 20}
            pcbY={27}
            pcbRotation={180}
          />
          <USBLC6_2SC6 name={`U_USB_ESD${i}`} pcbX={16 + i * 20} pcbY={22} />
          {link(`J_USB${i}`, "VBUS", `USB${i}_VBUS`)}
          {link(`J_USB${i}`, "GND", "GND")}
          {link(`J_USB${i}`, "SHIELD", "GND")}
          {link("U_USB_PWR", `OUT${i + 1}`, `USB${i}_VBUS`)}
          {link("U_USB_PWR", `EN${i + 1}`, `USB${i}_DRVVBUS`)}
          {link("U_USB_PWR", `OC${i + 1}`, `USB${i}_OCn`)}
          {link(`U_USB_ESD${i}`, "GND", "GND")}
          {link(`U_USB_ESD${i}`, "VBUS", `USB${i}_VBUS`)}
          <Res
            name={`R_USB_EN${i}`}
            a={`USB${i}_DRVVBUS`}
            b="GND"
            value="100k"
            x={17 + i * 3}
            y={15}
          />
          <Res
            name={`R_USB_OC${i}`}
            a={`USB${i}_OCn`}
            b="V3V3"
            x={23 + i * 3}
            y={12}
          />
          <UsbBulkCap
            name={`C_USB_BULK${i}`}
            pcbX={i ? 42 : 9}
            pcbY={i ? 16 : 19}
          />
          {link(`C_USB_BULK${i}`, "pin1", `USB${i}_VBUS`)}
          {link(`C_USB_BULK${i}`, "pin2", "GND")}
          <Cap
            name={`C_USB_ESD${i}`}
            net={`USB${i}_VBUS`}
            x={14 + i * 18}
            y={18}
          />
          <SignalTrace
            name={`USB${i}_HOST_ID`}
            from={cpuPin(`USB${i}_ID`)}
            to="net.GND"
            routingPhaseIndex={7}
          />
          {[
            ["DP", "IO1_A", "IO1_B"],
            ["DM", "IO2_A", "IO2_B"],
          ].map(([signal, a, b]) => (
            <Fragment key={signal}>
              <SignalTrace
                name={`USB${i}_${signal}_CPU`}
                from={cpuPin(`USB${i}_${signal}`)}
                to={`U_USB_ESD${i}.${a}`}
                routingPhaseIndex={3}
              />
              <SignalTrace
                name={`USB${i}_${signal}_PORT`}
                from={`U_USB_ESD${i}.${b}`}
                to={`J_USB${i}.${signal}`}
                routingPhaseIndex={3}
              />
            </Fragment>
          ))}
          {["CPU", "PORT"].map((segment) => (
            <differentialpair
              name={`USB${i}_${segment}`}
              positiveConnection={`USB${i}_DP_${segment}`}
              negativeConnection={`USB${i}_DM_${segment}`}
              targetDifferentialImpedance="90ohm"
              maxLengthSkew={0.15}
              pcbTraceGap={0.1}
            />
          ))}
        </Fragment>
      ))}
      {link("U1", "T14", "USB0_OCn")}
      {/* SPRS717L Table 4-2: V17/GPMC_A11, mode 7 = gpio1_27, VDDSHV3. */}
      {link("U1", "V17", "USB1_OCn")}
    </>
  );
}
