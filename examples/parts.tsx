import { simulation } from "@tscircuit/core"

// Shared TI inverter and transceiver models used by the examples.
export const Inverter = (props: { name: string; pcbX: number; pcbY?: number }) => (
  <>
    <chip
      name={props.name}
      manufacturerPartNumber="SN74LVC1G04DBV"
      footprint="sot23_5"
      pcbX={props.pcbX}
      pcbY={props.pcbY ?? 0}
      pinLabels={{ pin1: "NC", pin2: "A", pin3: "GND", pin4: "Y", pin5: "VCC" }}
    />
    <simulation.ibismodel
      componentRef={`.${props.name}`}
      ibisModelAsset={{
        project_relative_path: "models/sn74lvc1g04.ibs",
        url: "./models/sn74lvc1g04.ibs",
        mimetype: "text/plain",
      }}
      ibisComponentName="LVC1G04_DBV"
      ibisPinNameToPortLabel={{ "2": "A", "3": "GND", "4": "Y", "5": "VCC" }}
      ibisPinNameToModelName={{ "2": "LVC1G04_IN_33", "4": "LVC1G04_OUT_33" }}
      ibisPinNameToReferencePortLabels={{
        "2": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
        "4": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
      }}
    />
    <trace from={`.${props.name} > .VCC`} to="net.VCC" />
    <trace from={`.${props.name} > .GND`} to="net.GND" />
  </>
)

export const sn65hvd72 = {
  ibisModelAsset: {
    project_relative_path: "models/sn65hvd72.ibs",
    url: "./models/sn65hvd72.ibs",
    mimetype: "text/plain",
  },
  ibisComponentName: "SN65HVD72D",
  ibisPinNameToPortLabel: { "1": "R", "2": "RE", "3": "DE", "4": "D", "5": "GND", "6": "A", "7": "B", "8": "VCC" },
  ibisPinNameToModelName: { "1": "rpin", "2": "d_re", "3": "de", "4": "d_re", "6": "a_b_p", "7": "a_b_n" },
  ibisPinNameToReferencePortLabels: {
    "1": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
    "2": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
    "3": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
    "4": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
    "6": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
    "7": { pullup: "VCC", pulldown: "GND", powerClamp: "VCC", groundClamp: "GND" },
  },
}
export const transceiverPins = { pin1: "R", pin2: "RE", pin3: "DE", pin4: "D", pin5: "GND", pin6: "A", pin7: "B", pin8: "VCC" }
