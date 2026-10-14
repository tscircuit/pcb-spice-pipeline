import type { SimpleRouteJson } from "@tscircuit/bus-lanes-solver";
import saved from "./control-routes.json";

/** Replay inspected fixed copper, including explicit four-layer via spans.
 * Refuse changed endpoint placement. This adapter does not search for routes.
 */
export async function replayControlRoutes(input: SimpleRouteJson) {
  const traces = saved.map((entry) => {
    const first = entry.route[0]; const last=entry.route.at(-1)!;
    const matches = input.connections.filter(c => c.pointsToConnect.some(p =>
      p.pcb_port_id===entry.startPortId && (p.layer===first.layer || ("startExistingViaId" in entry && typeof entry.startExistingViaId==="string")) && Math.hypot(p.x-first.x,p.y-first.y)<1e-5));
    if(matches.length === 0) throw new Error(`Cached ${entry.name}: expected a connection at ${entry.from}, found ${matches.length}`);
    // A direct trace and an explicit net can describe the same port. Prefer
    // the net's full endpoint list; exact port identity prevents net ambiguity.
    const containsEnd = (c: typeof matches[number]) => c.pointsToConnect.some(p=>p.pcb_port_id===entry.endPortId && (p.layer===last.layer || ("endExistingViaId" in entry && typeof entry.endExistingViaId==="string")) && Math.hypot(p.x-last.x,p.y-last.y)<1e-5);
    const connection = matches.find(c=>"sourceTraceId" in entry && c.source_trace_id===entry.sourceTraceId) ?? matches.find(c=>containsEnd(c)&&c.source_trace_id) ?? matches.find(containsEnd) ?? matches.find(c=>c.source_trace_id) ?? matches.find(c=>c.name.startsWith("source_net_")) ?? matches[0];
    if(entry.endPortId && !containsEnd(connection)) {
      // Pour-connected nets can reach the custom phase as separate one-point
      // connections. Require exact pad identities/positions and an explicit
      // shared electrical net alias before joining such endpoints.
      const start = input.obstacles.find(o=>((o as any).circuitJsonMetadata?.pcb_port_id===entry.startPortId || ("startExistingViaId" in entry && (o as any).circuitJsonMetadata?.pcb_via_id===entry.startExistingViaId)) && Math.hypot(o.center.x-first.x,o.center.y-first.y)<1e-5);
      const end = input.obstacles.find(o=>((o as any).circuitJsonMetadata?.pcb_port_id===entry.endPortId || ("endExistingViaId" in entry && (o as any).circuitJsonMetadata?.pcb_via_id===entry.endExistingViaId)) && Math.hypot(o.center.x-last.x,o.center.y-last.y)<1e-5);
      const sameNet = start && end && start.layers.includes(first.layer!) && end.layers.includes(last.layer!) && start.connectedTo.some(id=>/^(source_net_|connectivity_net|net\.)/.test(id) && end.connectedTo.includes(id));
      if(!sameNet) throw new Error(`Cached ${entry.name}: destination moved or left its net`);
    }
    const route = structuredClone(entry.route);
    // A surface port on an existing plated through-via is also reachable on
    // its inner copper layers. Bind it only after validating the actual barrel.
    for (const [side, point] of [["start", route[0]], ["end", route.at(-1)!]] as const) {
      const viaId = (entry as any)[`${side}ExistingViaId`];
      if (!viaId) continue;
      const portId = entry[side === "start" ? "startPortId" : "endPortId"];
      const barrel = input.obstacles.find(o =>
        (o as any).circuitJsonMetadata?.pcb_via_id === viaId &&
        Math.hypot(o.center.x-point.x,o.center.y-point.y) < 1e-5 &&
        o.layers.includes(point.layer!) && !!portId && o.connectedTo.includes(portId));
      if (!barrel || point.route_type !== "wire") throw new Error(`Cached ${entry.name}: existing endpoint barrel changed`);
      (point as any)[`${side}_pcb_port_id`] = portId;
    }
    return {type: "pcb_trace" as const, pcb_trace_id: `saved_control_${entry.name}`,
      connection_name: connection.name,
      source_trace_id: "sourceTraceId" in entry && typeof entry.sourceTraceId==="string" ? entry.sourceTraceId : connection.source_trace_id ?? (/^source_(trace|net)_/.test(connection.name) ? connection.name : undefined),
      connectsTo: [connection.source_trace_id, ...connection.pointsToConnect.map(p=>p.pointId)].filter((id): id is string=>!!id),
      route};
  });
  const handlers: Record<string, ((event:any)=>void)[]> = {};
  return { input, isRouting:false,
    on(type:string,fn:(event:any)=>void){(handlers[type]??=[]).push(fn)},
    stop(){this.isRouting=false},
    async start(){this.isRouting=true;await Promise.resolve();this.isRouting=false;handlers.complete?.forEach(fn=>fn({type:"complete",traces}))},
    solveSync(){return traces},
  };
}
