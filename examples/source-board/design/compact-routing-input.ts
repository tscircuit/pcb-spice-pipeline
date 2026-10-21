import type {SimpleRouteJson} from '@tscircuit/bus-lanes-solver';

/** Remove unused repeated port aliases, preserving every routing owner, pad's
 * own identifiers, and explicit net identifiers. Geometry is never changed.
 * Ground pads otherwise repeat thousands of unrelated ports in each obstacle.
 */
export function compactRoutingInput<T extends SimpleRouteJson>(input:T):T {
 const used=new Set<string>();
 for(const c of input.connections){
  used.add(c.name);if(c.source_trace_id)used.add(c.source_trace_id);
  for(const p of c.pointsToConnect){if(p.pointId)used.add(p.pointId);if(p.pcb_port_id)used.add(p.pcb_port_id);}
 }
 for(const t of input.traces??[]){if(t.connection_name)used.add(t.connection_name);if(t.source_trace_id)used.add(t.source_trace_id);}
 return {...input,obstacles:input.obstacles.map(o=>{
  const metadata=(o as any).circuitJsonMetadata??{};
  const own=new Set([metadata.pcb_port_id,metadata.pcb_smtpad_id,metadata.pcb_via_id]);
  const connectedTo=o.connectedTo.filter(id=>used.has(id)||own.has(id)||/^(connectivity_net|source_net|net\.)/.test(id));
  // Keep an existing representative for otherwise unnamed, nonempty nets.
  if(!connectedTo.length&&o.connectedTo.length)connectedTo.push(o.connectedTo[0]);
  return {...o,connectedTo:[...new Set(connectedTo)]};
 })};
}
