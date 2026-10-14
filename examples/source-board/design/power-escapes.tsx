import bridges from "./power-bridges.json";
import {ramPoint,isRamRef} from "./ram-placement";
import { Fragment } from "react";
import escapes from "./power-escapes.json";
const ramVias = new Set(escapes.traces.filter(t=>isRamRef(t.from.split(" > ")[0].slice(1))).map(t=>t.via));
export function PowerEscapes() {
  if (process.env.SBC_SIGNAL_ROUTING === "1") return null;
  return (
    <>
      {escapes.vias.map((v) => (
        <Fragment key={v.name}>
          <via
            name={v.name}
            pcbX={ramVias.has(v.name)?ramPoint(v.x,v.y).x:v.x}
            pcbY={ramVias.has(v.name)?ramPoint(v.x,v.y).y:v.y}
            fromLayer="top"
            toLayer="bottom"
            layers={["top", "inner1", "inner2", "bottom"]}
            outerDiameter={0.3}
            holeDiameter={0.15}
            connectsTo={`net.${v.net}`}
          />
        </Fragment>
      ))}
      {(bridges as {name:string;fromVia:string;toVia:string;waypoints:{x:number;y:number}[]}[]).map(b=>(
        <trace key={b.name} name={b.name} from={`.${b.fromVia} > .bottom`} to={`.${b.toVia} > .bottom`} pcbPath={[`.${b.fromVia} > .bottom`,...b.waypoints,`.${b.toVia} > .bottom`]} />
      ))}
    </>
  );
}
export const escapeByTrace = new Map(escapes.traces.map((t) => [t.name, t]));
