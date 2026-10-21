import type { ChipProps } from "@tscircuit/props"
import { Fragment } from "react"

/**
 * TI TFP410PAP PanelBus transmitter.
 *
 * The PAP package is a 10 mm x 10 mm, 64-pin PowerPAD HTQFP with
 * 0.5 mm lead pitch. Pin names follow TI SLDS145D, Figure 4-1.
 */
const TFP410_PIN_NAMES = [
  "DVDD_1",
  "DE",
  "VREF",
  "HSYNC",
  "VSYNC",
  "A3_DK3",
  "CTL2_A2_DK2",
  "CTL1_A1_DK1",
  "EDGE_HTPLG",
  "PD",
  "MSEN_PO1",
  "DVDD_12",
  "ISEL_RST",
  "DSEL_SDA",
  "BSEL_SCL",
  "DGND_16",
  "PGND",
  "PVDD",
  "TFADJ",
  "TGND_20",
  "TXC_N",
  "TXC_P",
  "TVDD_23",
  "TX0_N",
  "TX0_P",
  "TGND_26",
  "TX1_N",
  "TX1_P",
  "TVDD_29",
  "TX2_N",
  "TX2_P",
  "TGND_32",
  "DVDD_33",
  "RESERVED",
  "DKEN",
  "DATA23",
  "DATA22",
  "DATA21",
  "DATA20",
  "DATA19",
  "DATA18",
  "DATA17",
  "DATA16",
  "DATA15",
  "DATA14",
  "DATA13",
  "DATA12",
  "DGND_48",
  "NC",
  "DATA11",
  "DATA10",
  "DATA9",
  "DATA8",
  "DATA7",
  "DATA6",
  "IDCK_N",
  "IDCK_P",
  "DATA5",
  "DATA4",
  "DATA3",
  "DATA2",
  "DATA1",
  "DATA0",
  "DGND_64",
  "THERMAL_PAD",
] as const

const TFP410_PIN_LABELS: Record<string, readonly string[]> = Object.fromEntries(
  TFP410_PIN_NAMES.map((name, index) => [
    `pin${index + 1}`,
    [name, `${index + 1}_${name}`],
  ]),
)

const LEAD_PITCH_MM = 0.5
const FIRST_LEAD_OFFSET_MM = -3.75
const LEAD_CENTER_MM = 5.7

const qfpPadPosition = (pinNumber: number) => {
  if (pinNumber <= 16) {
    return {
      x: FIRST_LEAD_OFFSET_MM + (pinNumber - 1) * LEAD_PITCH_MM,
      y: -LEAD_CENTER_MM,
      width: 0.3,
      height: 1.5,
    }
  }
  if (pinNumber <= 32) {
    return {
      x: LEAD_CENTER_MM,
      y: FIRST_LEAD_OFFSET_MM + (pinNumber - 17) * LEAD_PITCH_MM,
      width: 1.5,
      height: 0.3,
    }
  }
  if (pinNumber <= 48) {
    return {
      x: 3.75 - (pinNumber - 33) * LEAD_PITCH_MM,
      y: LEAD_CENTER_MM,
      width: 0.3,
      height: 1.5,
    }
  }
  return {
    x: -LEAD_CENTER_MM,
    y: 3.75 - (pinNumber - 49) * LEAD_PITCH_MM,
    width: 1.5,
    height: 0.3,
  }
}

export const Tfp410 = (props: ChipProps) => (
  <chip
    {...props}
    manufacturerPartNumber="TFP410PAP"
    pinLabels={TFP410_PIN_LABELS}
    footprint={
      <footprint>
        {Array.from({ length: 64 }, (_, index) => {
          const pinNumber = index + 1
          const pad = qfpPadPosition(pinNumber)
          return (
            <Fragment key={`tfp410-pad-${pinNumber}`}>
              <smtpad
                portHints={[`pin${pinNumber}`]}
                pcbX={pad.x}
                pcbY={pad.y}
                width={pad.width}
                height={pad.height}
                shape="rect"
              />
            </Fragment>
          )
        })}
        <smtpad
          portHints={["pin65"]}
          pcbX={0}
          pcbY={0}
          width="5.9mm"
          height="5.9mm"
          shape="rect"
        />
        <silkscreenpath
          route={[
            { x: -5.1, y: -5.1 },
            { x: 5.1, y: -5.1 },
            { x: 5.1, y: 5.1 },
            { x: -5.1, y: 5.1 },
            { x: -5.1, y: -5.1 },
          ]}
        />
        <silkscreencircle pcbX={-4.45} pcbY={-4.45} radius="0.22mm" />
        <courtyardrect width="13.4mm" height="13.4mm" />
      </footprint>
    }
  />
)
