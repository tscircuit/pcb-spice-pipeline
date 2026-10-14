import type { ConnectorProps } from "@tscircuit/props"

// KiCad USB_A_Stewart_SS-52100-001_Horizontal, manufacturer DR-STW-SS-52100-001.
// Footprint-local mm, +X right, +Y up. Convert KiCad's +Y-down once here;
// origin is the signal-row midpoint. The socket opens towards -Y.
export function UsbA(props: ConnectorProps) {
  return <connector {...props} manufacturerPartNumber="SS-52100-001" pinLabels={{pin1:"VBUS",pin2:"DM",pin3:"DP",pin4:"GND",pin5:"SHIELD"}} footprint={<footprint>
    {[0,2.5,4.5,7].map((x,i)=><platedhole portHints={[`pin${i+1}`]} pcbX={x-3.5} pcbY={0} shape="circle" holeDiameter={0.92} outerDiameter={1.6} />)}
    {[-3.07,10.07].map(x=><platedhole portHints={["pin5"]} pcbX={x-3.5} pcbY={-2.71} shape="circle" holeDiameter={2.3} outerDiameter={3} />)}
    <silkscreenrect pcbY={-5.74} width={12.5} height={13.5}/>
    <courtyardrect pcbY={-6} width={17.3} height={15}/>
  </footprint>}/>
}
