import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["5V_SUPPLY"],
  pin2: ["LV_SUPPLY"],
  pin3: ["GND1"],
  pin4: ["TMDS_D2_POS1"],
  pin5: ["TMDS_GND1"],
  pin6: ["TMDS_D2_NEG1"],
  pin7: ["TMDS_D1_POS1"],
  pin8: ["TMDS_GND2"],
  pin9: ["TMDS_D1_NEG1"],
  pin10: ["TMDS_D0_POS1"],
  pin11: ["TMDS_GND3"],
  pin12: ["TMDS_D0_NEG1"],
  pin13: ["TMDS_CK_POS1"],
  pin14: ["TMDS_GND4"],
  pin15: ["TMDS_CK_NEG1"],
  pin16: ["CE_REMOTE_IN"],
  pin17: ["DDC_CLK_IN"],
  pin18: ["DDC_DAT_IN"],
  pin19: ["HOTPLUG_DET_IN"],
  pin20: ["HOTPLUG_DET_OUT"],
  pin21: ["DDC_DAT_OUT"],
  pin22: ["DDC_CLK_OUT"],
  pin23: ["CE_REMOTE_OUT"],
  pin24: ["TMDS_CK_NEG2"],
  pin25: ["TMDS_GND5"],
  pin26: ["TMDS_CK_POS2"],
  pin27: ["TMDS_D0_NEG2"],
  pin28: ["TMDS_GND6"],
  pin29: ["TMDS_D0_POS2"],
  pin30: ["TMDS_D1_NEG2"],
  pin31: ["TMDS_GND7"],
  pin32: ["TMDS_D1_POS2"],
  pin33: ["TMDS_D2_NEG2"],
  pin34: ["TMDS_GND8"],
  pin35: ["TMDS_D2_POS2"],
  pin36: ["GND2"],
  pin37: ["ESD_BYP"],
  pin38: ["5V_OUT"]
} as const

export const TPD12S521DBTR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C126920"
  ]
}}
      manufacturerPartNumber="TPD12S521DBTR"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-4.501261mm" pcbY="-2.898521mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-3.998849mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-3.498215mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-2.998851mm" pcbY="-2.900553mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-2.498725mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-1.998853mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="-1.498727mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="-0.998855mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="-0.498729mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="0.001143mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="0.501269mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="1.001141mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="1.501267mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="2.001139mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="2.501265mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="3.001137mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="3.501263mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="4.001135mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="4.501261mm" pcbY="-2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="4.500499mm" pcbY="2.899283mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="4.001389mm" pcbY="2.900045mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="3.500501mm" pcbY="2.899283mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="3.002153mm" pcbY="2.899283mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="2.498979mm" pcbY="2.901061mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="2.000123mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="1.500251mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin27"]} pcbX="1.000125mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin28"]} pcbX="0.500253mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin29"]} pcbX="0.000127mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="-0.499745mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="-0.999871mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="-1.499743mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin33"]} pcbX="-1.999869mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin34"]} pcbX="-2.499741mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin35"]} pcbX="-2.999867mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin36"]} pcbX="-3.499739mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin37"]} pcbX="-3.999865mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<smtpad portHints={["pin38"]} pcbX="-4.499737mm" pcbY="2.899791mm" width="0.299974mm" height="1.2999974mm" shape="rect" />
<silkscreenpath route={[{"x":4.899990199999991,"y":2.199995599999994},{"x":4.899990199999991,"y":-2.199995599999994}]} />
<silkscreenpath route={[{"x":-4.899990200000005,"y":2.199995599999994},{"x":-4.8755046000000135,"y":2.199995599999994}]} />
<silkscreenpath route={[{"x":4.8763681999999875,"y":2.199995599999994},{"x":4.899990199999991,"y":2.199995599999994}]} />
<silkscreenpath route={[{"x":-4.899990200000005,"y":-2.199995599999994},{"x":-4.877307999999999,"y":-2.199995599999994}]} />
<silkscreenpath route={[{"x":4.8767237999999935,"y":-2.199995599999994},{"x":4.899990199999991,"y":-2.199995599999994}]} />
<silkscreenpath route={[{"x":-4.899990200000005,"y":2.199995599999994},{"x":-4.899990200000005,"y":0.5999987999999945}]} />
<silkscreenpath route={[{"x":-4.899990200000005,"y":-2.199995599999994},{"x":-4.899990200000005,"y":-0.5999988000000087}]} />
<silkscreenpath route={[{"x":-4.899990200000005,"y":0.5999987999999945},{"x":-4.6716131903481255,"y":0.5532084876141994},{"x":-4.478313994367298,"y":0.4228980402054958},{"x":-4.349280476912753,"y":0.22874412382982712},{"x":-4.303996489689936,"y":0.0000636647348386532},{"x":-4.349299841270479,"y":-0.22861295892019484},{"x":-4.478349799096122,"y":-0.42275594812119266},{"x":-4.67166002899215,"y":-0.5530500266061154},{"x":-4.900041000000016,"y":-0.5998210000000057}]} />
<silkscreenpath route={[{"x":-4.856606999999997,"y":-4.2000170000000026},{"x":-4.861488329829129,"y":-4.2370943811252175},{"x":-4.875799664755462,"y":-4.271644999999992},{"x":-4.89856571095433,"y":-4.3013142890456635},{"x":-4.928235000000001,"y":-4.324080335244545},{"x":-4.96278561887479,"y":-4.3383916701708785},{"x":-4.999862999999991,"y":-4.343273000000011},{"x":-5.036940381125206,"y":-4.3383916701708785},{"x":-5.071490999999995,"y":-4.324080335244545},{"x":-5.10116028904568,"y":-4.3013142890456635},{"x":-5.1239263352445334,"y":-4.271644999999992},{"x":-5.138237670170881,"y":-4.2370943811252175},{"x":-5.143119000000013,"y":-4.2000170000000026},{"x":-5.138237670170881,"y":-4.162939618874788},{"x":-5.1239263352445334,"y":-4.128389000000013},{"x":-5.10116028904568,"y":-4.098719710954327},{"x":-5.071490999999995,"y":-4.075953664755474},{"x":-5.036940381125206,"y":-4.061642329829127},{"x":-4.999862999999991,"y":-4.0567609999999945},{"x":-4.96278561887479,"y":-4.061642329829127},{"x":-4.928235000000001,"y":-4.075953664755474},{"x":-4.89856571095433,"y":-4.098719710954327},{"x":-4.875799664755462,"y":-4.128389000000013},{"x":-4.861488329829129,"y":-4.162939618874788},{"x":-4.856606999999997,"y":-4.2000170000000026}]} />
<silkscreentext text="{NAME}" pcbX="-0.119761mm" pcbY="4.550539mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-5.386261000000019,"y":3.8005389999999863},{"x":5.146738999999982,"y":3.8005389999999863},{"x":5.146738999999982,"y":-4.598861000000014},{"x":-5.386261000000019,"y":-4.598861000000014},{"x":-5.386261000000019,"y":3.8005389999999863}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C126920.obj?uuid=686a1e7cebe7400ba83edabaff0aacae",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C126920.step?uuid=686a1e7cebe7400ba83edabaff0aacae",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.000012700000013410317, y: 0, z: 0 },
      }}
      {...props}
    />
  )
}