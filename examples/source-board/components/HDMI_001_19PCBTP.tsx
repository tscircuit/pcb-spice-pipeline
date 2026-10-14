import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"],
  pin4: ["pin4"],
  pin5: ["pin5"],
  pin6: ["pin6"],
  pin7: ["pin7"],
  pin8: ["pin8"],
  pin9: ["pin9"],
  pin10: ["pin10"],
  pin11: ["pin11"],
  pin12: ["pin12"],
  pin13: ["CEC"],
  pin14: ["pin14"],
  pin15: ["SCL"],
  pin16: ["SDA"],
  pin17: ["pin17"],
  pin18: ["pin18"],
  pin19: ["pin19"],
  pin20: ["pin20"],
  pin21: ["pin21"],
  pin22: ["pin22"],
  pin23: ["pin23"]
} as const

export const HDMI_001_19PCBTP = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C138388"
  ]
}}
      manufacturerPartNumber="HDMI_001_19PCBTP"
      footprint={<footprint>
        <platedhole  portHints={["pin20"]} pcbX="7.250176mm" pcbY="-4.0049767mm" holeWidth="0.9000236mm" holeHeight="2.1000466mm" outerWidth="1.499997mm" outerHeight="2.70002mm" shape="pill" />
<platedhole  portHints={["pin21"]} pcbX="-7.250176mm" pcbY="-4.0049767mm" holeWidth="0.9000236mm" holeHeight="2.1000466mm" outerWidth="1.499997mm" outerHeight="2.70002mm" shape="pill" />
<platedhole  portHints={["pin22"]} pcbX="7.250176mm" pcbY="1.9955193mm" holeWidth="0.9000236mm" holeHeight="2.6999946mm" outerWidth="1.499997mm" outerHeight="3.299968mm" shape="pill" />
<platedhole  portHints={["pin23"]} pcbX="-7.250176mm" pcbY="1.9955193mm" holeWidth="0.9000236mm" holeHeight="2.6999946mm" outerWidth="1.499997mm" outerHeight="3.299968mm" shape="pill" />
<smtpad portHints={["pin10"]} pcbX="0mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin9"]} pcbX="0.50038mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin8"]} pcbX="1.00076mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin7"]} pcbX="1.50114mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin6"]} pcbX="1.99898mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin5"]} pcbX="2.49936mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin4"]} pcbX="2.99974mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin3"]} pcbX="3.50012mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin2"]} pcbX="4.0005mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin1"]} pcbX="4.50088mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin11"]} pcbX="-0.50038mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin12"]} pcbX="-1.00076mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin13"]} pcbX="-1.4986mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin14"]} pcbX="-1.99898mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin15"]} pcbX="-2.49936mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin16"]} pcbX="-2.99974mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin17"]} pcbX="-3.50012mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin18"]} pcbX="-4.0005mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin19"]} pcbX="-4.50088mm" pcbY="2.7549793mm" width="0.2800096mm" height="2.5999948mm" radius="0.1400048mm" shape="pill" />
<silkscreenpath route={[{"x":-7.800340000000006,"y":-5.6244806999999355},{"x":-7.800340000000006,"y":-8.12384069999996},{"x":7.800340000000006,"y":-8.12384069999996},{"x":7.799984399999971,"y":-5.42448109999998}]} />
<silkscreenpath route={[{"x":7.799984399999971,"y":0.1755076999999119},{"x":7.799984399999971,"y":-2.2244875000000093}]} />
<silkscreenpath route={[{"x":-7.799984400000085,"y":0.1755076999999119},{"x":-7.799984400000085,"y":-2.324487299999987}]} />
<silkscreenpath route={[{"x":-4.8999902000000475,"y":2.475503099999969},{"x":-5.99998800000003,"y":2.475503099999969},{"x":-5.99998800000003,"y":3.3755012999999963},{"x":-6.299987400000077,"y":3.3755012999999963}]} />
<silkscreenpath route={[{"x":4.899990199999934,"y":2.475503099999969},{"x":5.799988399999961,"y":2.475503099999969},{"x":5.799988399999961,"y":3.4755010999998603},{"x":6.299987399999964,"y":3.4755010999998603}]} />
<silkscreenpath route={[{"x":-2.499868000000106,"y":-5.745130700000004},{"x":-2.999994000000129,"y":-2.245010699999966},{"x":-3.99999200000002,"y":-2.245010699999966}]} />
<silkscreenpath route={[{"x":-3.99999200000002,"y":-2.245010699999966},{"x":-4.499864000000116,"y":-5.745130700000004}]} />
<silkscreenpath route={[{"x":2.5001219999999194,"y":-5.745130700000004},{"x":2.999994000000015,"y":-2.245010699999966},{"x":3.9999919999999065,"y":-2.245010699999966},{"x":4.5001179999999295,"y":-5.745130700000004}]} />
<silkscreenpath route={[{"x":-3.199891999999977,"y":-2.84495870000012},{"x":-3.8000939999999446,"y":-2.84495870000012}]} />
<silkscreenpath route={[{"x":3.1998919999998634,"y":-2.84495870000012},{"x":3.800093999999831,"y":-2.84495870000012}]} />
<silkscreentext text="{NAME}" pcbX="0mm" pcbY="5.0503793mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-8.25100000000009,"y":4.300379299999918},{"x":8.250999999999976,"y":4.300379299999918},{"x":8.250999999999976,"y":-8.366220700000099},{"x":-8.25100000000009,"y":-8.366220700000099},{"x":-8.25100000000009,"y":4.300379299999918}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C138388.obj?uuid=b13a67d988f844af960721e31def9dcc",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C138388.step?uuid=b13a67d988f844af960721e31def9dcc",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 7.9114819, z: -3.0250044 },
      }}
      {...props}
    />
  )
}