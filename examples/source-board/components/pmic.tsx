import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["VLDO2"],
  pin2: ["VINLDO"],
  pin3: ["VLDO1"],
  pin4: ["BAT1"],
  pin5: ["BAT2"],
  pin6: ["BAT_SENSE"],
  pin7: ["SYS1"],
  pin8: ["SYS2"],
  pin9: ["PWR_EN"],
  pin10: ["AC"],
  pin11: ["TS"],
  pin12: ["USB"],
  pin13: ["nWAKEUP"],
  pin14: ["MUX_IN"],
  pin15: ["NC1"],
  pin16: ["MUX_OUT"],
  pin17: ["NC2"],
  pin18: ["VIO"],
  pin19: ["VDCDC1"],
  pin20: ["L1"],
  pin21: ["VIN_DCDC1"],
  pin22: ["VIN_DCDC2"],
  pin23: ["L2"],
  pin24: ["VDCDC2"],
  pin25: ["PB_IN"],
  pin26: ["PGOOD"],
  pin27: ["SDA"],
  pin28: ["SCL"],
  pin29: ["VDCDC3"],
  pin30: ["PGND"],
  pin31: ["L3"],
  pin32: ["VIN_DCDC3"],
  pin33: ["ISINK2"],
  pin34: ["ISINK1"],
  pin35: ["ISET1"],
  pin36: ["ISET2"],
  pin37: ["L4"],
  pin38: ["FB_WLED"],
  pin39: ["LS1_IN"],
  pin40: ["LS1_OUT"],
  pin41: ["AGND"],
  pin42: ["LS2_IN"],
  pin43: ["LS2_OUT"],
  pin44: ["nRESET"],
  pin45: ["nINT"],
  pin46: ["LDO_PGOOD"],
  pin47: ["BYPASS"],
  pin48: ["INT_LDO"],
  pin49: ["EP"]
} as const

const pinAttributes = {
  pin15: {doNotConnect: true},
  pin17: {doNotConnect: true},
  pin30: {requiresGround: true},
  pin41: {requiresGround: true}
} as const

export const TPS65217CRSLR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C116081"
  ]
}}
      manufacturerPartNumber="TPS65217CRSLR"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-2.200021mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-1.799971mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-1.399921mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-1.000125mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-0.600075mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-0.200025mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="0.200025mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="0.600075mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="0.999871mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="1.399921mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="1.799971mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="2.200021mm" pcbY="-2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="2.200021mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="1.799971mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin27"]} pcbX="1.399921mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin28"]} pcbX="0.999871mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin29"]} pcbX="0.600075mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="0.200025mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="-0.200025mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="-0.600075mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin33"]} pcbX="-1.000125mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin34"]} pcbX="-1.399921mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin35"]} pcbX="-1.799971mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin36"]} pcbX="-2.200021mm" pcbY="2.974975mm" width="0.1999996mm" height="0.850011mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="2.974975mm" pcbY="-2.200021mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="2.974975mm" pcbY="-1.799971mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="2.974975mm" pcbY="-1.399921mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="2.974975mm" pcbY="-0.999871mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="2.974975mm" pcbY="-0.600075mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="2.974975mm" pcbY="-0.200025mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="2.974975mm" pcbY="0.200025mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="2.974975mm" pcbY="0.600075mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="2.974975mm" pcbY="1.000125mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="2.974975mm" pcbY="1.400175mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="2.974975mm" pcbY="1.799971mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="2.974975mm" pcbY="2.200021mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin37"]} pcbX="-2.974975mm" pcbY="2.200021mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin38"]} pcbX="-2.974975mm" pcbY="1.799971mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin39"]} pcbX="-2.974975mm" pcbY="1.400175mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin40"]} pcbX="-2.974975mm" pcbY="1.000125mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-2.974975mm" pcbY="0.600075mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin42"]} pcbX="-2.974975mm" pcbY="0.200025mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin43"]} pcbX="-2.974975mm" pcbY="-0.200025mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin44"]} pcbX="-2.974975mm" pcbY="-0.600075mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin45"]} pcbX="-2.974975mm" pcbY="-0.999871mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin46"]} pcbX="-2.974975mm" pcbY="-1.399921mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin47"]} pcbX="-2.974975mm" pcbY="-1.799971mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin48"]} pcbX="-2.974975mm" pcbY="-2.200021mm" width="0.850011mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin49"]} pcbX="-0.000127mm" pcbY="0.000127mm" width="4.0500046mm" height="4.0500046mm" shape="rect" />
<silkscreenpath route={[{"x":-3.4290253999998868,"y":-2.539974600000164},{"x":-3.4290253999998868,"y":-2.7939746000000696},{"x":-2.7940254000000095,"y":-3.4289746000000605},{"x":-2.5400253999998768,"y":-3.4289746000000605}]} />
<silkscreenpath route={[{"x":3.428974600000174,"y":-2.539974600000164},{"x":3.428974600000174,"y":-3.4289746000000605},{"x":2.5399746000000505,"y":-3.4289746000000605}]} />
<silkscreenpath route={[{"x":2.5399746000000505,"y":3.4290253999998868},{"x":3.428974600000174,"y":3.4290253999998868},{"x":3.428974600000174,"y":2.5400253999999904}]} />
<silkscreenpath route={[{"x":-3.4290253999998868,"y":2.5400253999999904},{"x":-3.4290253999998868,"y":3.4290253999998868},{"x":-2.5400253999998768,"y":3.4290253999998868}]} />
<silkscreencircle pcbX="-2.200021mm" pcbY="-3.699891mm" radius="0.056134mm" />
<silkscreentext text="{NAME}" pcbX="0.009779mm" pcbY="4.425825mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-3.669220999999993,"y":3.6758249999998043},{"x":3.6887790000000678,"y":3.6758249999998043},{"x":3.6887790000000678,"y":-4.01237500000002},{"x":-3.669220999999993,"y":-4.01237500000002},{"x":-3.669220999999993,"y":3.6758249999998043}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C116081.obj?uuid=dc9ecc2441db447baa43f5a79af55430",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C116081.step?uuid=dc9ecc2441db447baa43f5a79af55430",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0, z: 0 },
      }}
      {...props}
    />
  )
}