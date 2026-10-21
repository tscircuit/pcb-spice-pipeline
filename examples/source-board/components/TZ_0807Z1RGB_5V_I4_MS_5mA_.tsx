import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["DOU"],
  pin2: ["GND"],
  pin3: ["DIN"],
  pin4: ["VDD"]
} as const

const pinAttributes = {
  pin2: {requiresGround: true},
  pin4: {requiresPower: true}
} as const

export const TZ_0807Z1RGB_5V_I4_MS_5mA_ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C26159667"
  ]
}}
      manufacturerPartNumber="TZ-0807Z1RGB-5V-I4-MS(5mA)"
      footprint={<footprint>
        <smtpad portHints={["pin4"]} pcbX="-0.962914mm" pcbY="-0.55499mm" width="1.0750042mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-0.962914mm" pcbY="0.55499mm" width="1.0750042mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="0.962914mm" pcbY="-0.55499mm" width="1.0750042mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0.962914mm" pcbY="0.55499mm" width="1.0750042mm" height="0.8999982mm" shape="rect" />
<silkscreenpath route={[{"x":0.1944115999999667,"y":0.8999727999998868},{"x":-0.19433539999999994,"y":0.8999727999998868}]} />
<silkscreenpath route={[{"x":-0.19433539999999994,"y":-0.8999728000000005},{"x":0.1944115999999667,"y":-0.8999728000000005}]} />
<silkscreenpath route={[{"x":-0.19433539999999994,"y":-0.8999728000000005},{"x":0.1944115999999667,"y":-0.8999728000000005}]} />
<silkscreentext text="{NAME}" pcbX="0.548386mm" pcbY="2.005586mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{x:-1.75,y:1.25},{x:1.75,y:1.25},{x:1.75,y:-1.25},{x:-1.75,y:-1.25}]} />
      </footprint>}
      
      {...props}
    />
  )
}