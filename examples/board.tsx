import base from './straight.json'
// tscircuit generates the ports, source connectivity and routed PCB centerlines.
// Physical extraction inputs remain explicit; vendor pin bindings come from base.
export const modeling = {
  ...base,
  description: 'Routed native tscircuit TSX entry; straightened finite-return channel',
  lanes: [
    {port:'DQS',from:{component:'U1',port:'DQS'},to:{component:'U2',port:'DQS'}},
    {port:'DQSn',from:{component:'U1',port:'DQSn'},to:{component:'U2',port:'DQSn'}},
  ],
}
export default () => (
  <board width="24mm" height="12mm" routingDisabled>
    <chip name="U1" footprint="soic8" pcbX={-7} pcbY={0}
      pinLabels={{pin1:'DQS',pin2:'DQSn'}} />
    <chip name="U2" footprint="soic8" pcbX={7} pcbY={0}
      pinLabels={{pin1:'DQS',pin2:'DQSn'}} />
    <trace from=".U1 > .DQS" to=".U2 > .DQS" thickness="0.1mm"
      pcbPath={[{x:-3,y:2},{x:3,y:2}]} />
    <trace from=".U1 > .DQSn" to=".U2 > .DQSn" thickness="0.1mm"
      pcbPath={[{x:-3,y:3},{x:3,y:3}]} />
  </board>
)
