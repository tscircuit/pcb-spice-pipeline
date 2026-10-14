import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["G"],
  pin2: ["S"],
  pin3: ["D"]
} as const

export const AO3400A = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      symbol={
        <symbol>
          <schematictext text={props.name} schX={-0.6} schY={0.7} fontSize={0.18} />
          <schematicpath points={[{"x":0,"y":0},{"x":0.12,"y":-0.04},{"x":0.12,"y":0.04},{"x":0,"y":0}]} strokeColor="#880000" isFilled fillColor="#FEFEFE" />
          <schematicpath points={[{"x":0.4,"y":0.04},{"x":0.34,"y":-0.06},{"x":0.46,"y":-0.06},{"x":0.4,"y":0.04}]} strokeColor="#880000" isFilled fillColor="#FEFEFE" />
          <schematicpath points={[{"x":0,"y":0.14},{"x":0.2,"y":0.14},{"x":0.2,"y":0.2},{"x":0.4,"y":0.2},{"x":0.4,"y":0.04}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":0},{"x":0.2,"y":0},{"x":0.2,"y":-0.2},{"x":0.4,"y":-0.2},{"x":0.4,"y":-0.06}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.2,"y":-0.14},{"x":0,"y":-0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.04,"y":0.18},{"x":-0.04,"y":-0.18}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":0.18},{"x":0,"y":0.1}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":-0.04},{"x":0,"y":0.04}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":-0.18},{"x":0,"y":-0.1}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.2,"y":0},{"x":-0.04,"y":0}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.48,"y":0.04},{"x":0.44,"y":0.04},{"x":0.36,"y":0.04},{"x":0.32,"y":0.04}]} strokeColor="#880000" />
          <port name="G" pinNumber={1} aliases={["G"]} direction="left" schX={-0.4} schY={0} schStemLength={0.2} />
          <port name="S" pinNumber={2} aliases={["S"]} direction="down" schX={0.2} schY={-0.4} schStemLength={0.2} />
          <port name="D" pinNumber={3} aliases={["D"]} direction="up" schX={0.2} schY={1} schStemLength={0.8} />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C20917"
  ]
}}
      manufacturerPartNumber="AO3400A"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="0.999998mm" pcbY="-0.94996mm" width="0.999998mm" height="0.6500114mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0.999998mm" pcbY="0.94996mm" width="0.999998mm" height="0.6500114mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-0.999998mm" pcbY="0mm" width="0.999998mm" height="0.6500114mm" shape="rect" />
<silkscreenpath route={[{"x":0.726211400000011,"y":1.5262098000000606},{"x":-0.726211400000011,"y":1.5262098000000606},{"x":-0.726211400000011,"y":0.49458879999997407}]} />
<silkscreenpath route={[{"x":0.726211400000011,"y":-1.5262097999999469},{"x":-0.726211400000011,"y":-1.5262097999999469},{"x":-0.726211400000011,"y":-0.49458879999997407}]} />
<silkscreenpath route={[{"x":0.726211400000011,"y":0.45539659999997184},{"x":0.726211400000011,"y":-0.45539659999985815}]} />
<silkscreentext text="{NAME}" pcbX="0.0254mm" pcbY="2.524mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-1.748600000000124,"y":1.774000000000001},{"x":1.7993999999998778,"y":1.774000000000001},{"x":1.7993999999998778,"y":-1.774000000000001},{"x":-1.748600000000124,"y":-1.774000000000001},{"x":-1.748600000000124,"y":1.774000000000001}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C20917.obj?uuid=d777607a152f4f3aac9bb0d0c14ed6fd",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C20917.step?uuid=d777607a152f4f3aac9bb0d0c14ed6fd",
        pcbRotationOffset: 180,
        modelOriginPosition: { x: 0.000012700000070253736, y: -0.000012699999956566899, z: 0.050795 },
      }}
      {...props}
    />
  )
}
