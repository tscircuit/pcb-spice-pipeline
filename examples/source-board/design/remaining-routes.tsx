import controlRoutes from "./control-routes.json";
import { Fragment } from "react";
import savedRoutes from './remaining-routes.json';
import sourceNets from './source-net-names.json';

type PathPoint = {x:number;y:number;via?:boolean;
  fromLayer?:'top'|'inner1'|'inner2'|'bottom';
  toLayer?:'top'|'inner1'|'inner2'|'bottom'};
type SavedRoute = {name:string;net:string;from:string;to:string;width:number;
  waypoints:PathPoint[];toPoint?:{x:number;y:number}};
const routes = savedRoutes as SavedRoute[];
const cachedRouteNames = new Set(controlRoutes.map(r=>r.name));
const cachedNetNames = new Set(controlRoutes.map(r=>r.net));
/** Additional branches are net connections, with explicit physical endpoints. */
export function RemainingRoutes() {
  return <>
    {[...new Set(routes.map(r => r.net))].filter(n => !sourceNets.includes(n)).map(name => <Fragment key={name}><net name={`ROUTED_${name}`} routingPhaseIndex={cachedNetNames.has(name) ? 2 : undefined} /></Fragment>)}
    {[...new Set(controlRoutes.map(r=>r.net))].filter(n=>sourceNets.includes(n)).map(name=><Fragment key={name}><net name={name} routingPhaseIndex={2} /></Fragment>)}
    {routes.map(route => <trace
    key={route.name}
    name={route.name}
    from={route.from}
    to={`net.${sourceNets.includes(route.net) ? route.net : `ROUTED_${route.net}`}`}
    thickness={route.width}
    routingPhaseIndex={cachedRouteNames.has(route.name) ? 2 : undefined}
    pcbPathRelativeTo={route.from}
    pcbPath={cachedRouteNames.has(route.name) ? undefined : [route.from,
      ...route.waypoints.flatMap(p => p.via ? [{x:p.x,y:p.y}, p, {x:p.x,y:p.y}] : [p]),
      route.toPoint ?? route.to]}
  />)}</>;
}
