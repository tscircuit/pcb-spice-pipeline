import decouplerFootprints from "./decoupler-footprints.json";
import type { TraceProps } from "@tscircuit/props";
import { Fragment, createContext, useContext } from "react";
import { escapeByTrace } from "./power-escapes";
import ballMap from "./am3352-ballmap.json";

export const PeripheralRoutingContext = createContext<boolean | number[]>(true);
export function SignalTrace(props: TraceProps) {
  const mode = useContext(PeripheralRoutingContext);
  const enabled = Array.isArray(mode) ? mode.includes(props.routingPhaseIndex ?? -1) : mode;
  const escape = process.env.SBC_SIGNAL_ROUTING === "1" ? undefined : props.name ? escapeByTrace.get(props.name) : undefined;
  if (escape) {
    const endpoint=(escape as {directPlaneEndpoint?: {x:number;y:number}|null}).directPlaneEndpoint;
    const end=endpoint ? {...endpoint,layer:escape.layer as "top"|"bottom"} : `.${escape.via} > .${escape.layer}`;
    return (
      <trace
        {...props}
        pcbPath={[
          escape.from,
          ...((escape as typeof escape & {waypoints?: {x:number;y:number}[]}).waypoints ?? []).map(w => ({
            ...w,
            layer: escape.layer as "top" | "bottom",
          })),
          end,
        ]}
        routingPhaseIndex={undefined}
      />
    );
  }
  return (
    <trace
      {...props}
      routingPhaseIndex={enabled ? props.routingPhaseIndex : undefined}
    />
  );
}

export const cpuPin = (signal: string) => {
  const ball = Object.entries(ballMap).find(([, name]) => name === signal)?.[0];
  if (!ball) throw new Error(`Unknown AM3352 signal ${signal}`);
  return `U1.${ball}`;
};
export const phaseForNet = (net: string) =>
  net === "GND"
    ? 7
    : /^(VDD|V[13]|DDR_1V5|RTC_1V8|A3V3|VIN|SYS|PD_VBUS|USB[01]_VBUS)/.test(net)
      ? 6
      : 5;
export function Link({
  refdes,
  pin,
  net,
}: {
  refdes: string;
  pin: string;
  net: string;
}) {
  return (
    <SignalTrace
      name={`T_${refdes}_${pin}`}
      from={`${refdes}.${pin}`}
      to={`net.${net}`}
      routingPhaseIndex={phaseForNet(net)}
    />
  );
}
export const link = (refdes: string, pin: string, net: string) => (
  <Link key={`${refdes}_${pin}`} refdes={refdes} pin={pin} net={net} />
);
export function Cap({
  name,
  net,
  value = "100nF",
  x,
  y,
  layer = "top",
  rotation = 0,
}: {
  name: string;
  net: string;
  value?: string;
  x: number;
  y: number;
  layer?: "top" | "bottom";
  rotation?: number;
}) {
  return (
    <Fragment>
      <capacitor
        name={name}
        capacitance={value}
        footprint={
          (decouplerFootprints as Record<string, string>)[name] ?? (name === "C_SYS_LOCAL"
            ? "0603"
            : value.includes("uF")
              ? "0805"
              : "0402")
        }
        pcbX={x}
        pcbY={y}
        layer={layer}
        pcbRotation={rotation}
      />
      {link(name, "pin1", net)}
      {link(name, "pin2", "GND")}
    </Fragment>
  );
}
export function Res({
  name,
  a,
  b,
  value = "10k",
  x,
  y,
  layer = "top",
  rotation = 0,
}: {
  name: string;
  a: string;
  b: string;
  value?: string;
  x: number;
  y: number;
  layer?: "top" | "bottom";
  rotation?: number;
}) {
  return (
    <Fragment>
      <resistor
        name={name}
        resistance={value}
        footprint="0402"
        pcbX={x}
        pcbY={y}
        layer={layer}
        pcbRotation={rotation}
      />
      {link(name, "pin1", a)}
      {link(name, "pin2", b)}
    </Fragment>
  );
}
