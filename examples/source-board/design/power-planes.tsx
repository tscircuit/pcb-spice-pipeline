import { Fragment } from "react";
import regions from './power-pour-regions.json';
/** Separate rail pours. Boundaries preserve the saved inner1 signal references. */
export const topPowerNet = 'DDR_1V5';
export const planeNetMap = { top: ['DDR_1V5', 'V3V3'], bottom: ['GND'] };
export function PowerPlanes() {
  return <>
    {regions.map(region => <Fragment key={region.name}><copperpour name={region.name}
      layer="top" connectsTo={`net.${region.net}`} outline={region.outline}
      clearance={0.13} boardEdgeMargin={0} /></Fragment>)}
    <copperpour name="BOTTOM_GND" layer="bottom" connectsTo="net.GND"
      clearance={0.13} boardEdgeMargin={0.4} />
  </>;
}
