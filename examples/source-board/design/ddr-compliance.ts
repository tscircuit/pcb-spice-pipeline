import type { SimpleRouteJson, Trace } from "@tscircuit/bus-lanes-solver";
import { DDR_RULES, ddrTimingGroups, ddrPairs, ddrTraceName } from "./ddr-rules";
import { sharedNets } from "./ddr-netlist";

export type SignalNames = Record<string, string>;
/** Core exports bus members in the declared connections order. Used only by
 * the router adapter; the independent board audit resolves actual source nets.
 */
export function signalNamesFromDeclaredBuses(input: SimpleRouteJson): SignalNames {
  const names: SignalNames = {};
  for (const group of ddrTimingGroups) {
    const bus = input.buses?.find(b => b.busId === group.name || b.name === group.name);
    if (!bus || bus.connectionNames.length !== group.signals.length)
      throw new Error(`Missing or incomplete timing bus: ${group.name}`);
    bus.connectionNames.forEach((name, i) => {
      if (names[name]) throw new Error(`Signal occurs in more than one DDR timing group: ${name}`);
      names[name] = group.signals[i];
    });
  }
  const remaining = input.connections.filter(c => !names[c.name]);
  if (remaining.length !== 1) throw new Error("Expected only RESET# outside clocked DDR timing groups");
  names[remaining[0].name] = "DDR_RESETn_SIGNAL";
  assertDdrConstraints(input, names);
  return names;
}
export function assertDdrConstraints(input: SimpleRouteJson, names: SignalNames) {
  const problems: string[] = [];
  const connectionBySignal = new Map(input.connections.map(c => [names[c.name], c.name]));
  const expectedSignals = sharedNets.map(ddrTraceName);
  if (input.connections.length !== expectedSignals.length ||
      expectedSignals.some(n => !connectionBySignal.has(n)))
    problems.push("DDR input must contain every one of the 47 CPU-to-RAM signals exactly once");
  for (const group of ddrTimingGroups) {
    const actual = input.buses?.find(b => b.name === group.name || b.busId === group.name);
    const expected = group.signals.map(s => connectionBySignal.get(s)).sort();
    if (!actual || JSON.stringify([...actual.connectionNames].sort()) !== JSON.stringify(expected) ||
        actual.maxLengthSkew === undefined || !Number.isFinite(actual.maxLengthSkew) || actual.maxLengthSkew < 0 || actual.maxLengthSkew > group.maxLengthSkew)
      problems.push(`Missing, incomplete or relaxed timing bus: ${group.name}`);
    if (!actual?.allowedLayers?.length || actual.allowedLayers.some(l => !DDR_RULES.signalLayers.includes(l as any)))
      problems.push(`Missing inner-layer restriction: ${group.name}`);
  }
  for (const pair of ddrPairs) {
    const members = pair.signals.map(s => connectionBySignal.get(s));
    const actual = input.differentialPairs?.find(p => p.connectionNames.length === 2 && p.connectionNames[0] === members[0] && p.connectionNames[1] === members[1]);
    if (!actual || !Number.isFinite(actual.lengthTolerance) || actual.lengthTolerance < 0 || actual.lengthTolerance > DDR_RULES.pairSkewMm)
      problems.push(`Missing or relaxed differential pair: ${pair.name}`);
  }
  if (problems.length) throw new Error(problems.join("; "));
}

/** Pad-to-pad copper lengths include surface escapes. Through-via delays are
 * not guessed: stackup, package flight times, impedance and SI remain separate gates.
 */
export function auditDdrGeometry(input: SimpleRouteJson, traces: Trace[], names: SignalNames) {
  const failures: string[] = [];
  try { assertDdrConstraints(input, names); } catch (e) { failures.push(String(e)); }
  const eps = 1e-7;
  const measurements = input.connections.map(c => {
    const failureCountBefore = failures.length;
    const matches = traces.filter(t => (t.connection_name ?? t.source_trace_id) === c.name);
    const trace = matches[0];
    if (matches.length !== 1) failures.push(`${names[c.name]}: expected one complete route, got ${matches.length}`);
    let lengthMm = 0;
    for (let i = 1; i < (trace?.route.length ?? 0); i++) {
      const a = trace.route[i-1], b = trace.route[i];
      if (![a.x,a.y,b.x,b.y].every(Number.isFinite)) failures.push(`${names[c.name]}: nonfinite route coordinate`);
      if (a.route_type === "wire" && b.route_type === "wire") {
        if (a.layer !== b.layer) failures.push(`${names[c.name]}: layer change without a via`);
        else lengthMm += Math.hypot(a.x-b.x, a.y-b.y);
      }
    }
    const endpoints = trace ? [trace.route[0], trace.route.at(-1)!] : [];
    if (endpoints.length !== 2 || c.pointsToConnect.some(p => !endpoints.some(q => Math.hypot(p.x-q.x,p.y-q.y)<1e-5)))
      failures.push(`${names[c.name]}: route endpoints do not match pads`);
    const vias = trace?.route.flatMap((p,i) => p.route_type === "via" ? [i] : []) ?? [];
    const innerLayers = [...new Set(trace?.route.flatMap(p => p.route_type === "wire" && p.layer !== "top" ? [p.layer] : []))];
    if (vias.length !== 2 || innerLayers.length !== 1 || !DDR_RULES.signalLayers.includes(innerLayers[0] as any) ||
        trace?.route.slice(vias[0]+1,vias[1]).some(p => p.route_type === "wire" && p.layer === "top"))
      failures.push(`${names[c.name]}: expected one inner carrier and two pad escapes`);
    const [a,b] = c.pointsToConnect;
    return {name:names[c.name], connectionName:c.name, lengthMm, padManhattanMm:Math.abs(a.x-b.x)+Math.abs(a.y-b.y), innerLayers, routePass:failures.length===failureCountBefore};
  });
  const groups = ddrTimingGroups.map(group => {
    const members = group.signals.map(s => measurements.find(m => m.name === s)!);
    if (members.some(m => !m)) { failures.push(`${group.name}: missing members`); return {name:group.name,pass:false}; }
    const lengths = members.map(m => m.lengthMm), min = Math.min(...lengths), max = Math.max(...lengths);
    const isCA = group.name === "DDR_ADDR_CTRL_CK";
    // Table 7-69 footnotes 4/5 define DQLM from DQ[x] (DQ+DM),
    // not the associated DQS clock class. Apply that ceiling to DQS too
    // as a conservative project requirement.
    const nominalMembers = isCA ? members : members.filter(m => !/^DDR_DQSn?/.test(m.name));
    const manhattan = Math.max(...nominalMembers.map(m => m.padManhattanMm));
    const nominalMm = manhattan + (isCA ? DDR_RULES.caManhattanAllowanceMm : 0);
    const minimumMm = isCA ? nominalMm-DDR_RULES.caNominalToleranceMm : 0;
    const maximumMm = isCA ? Math.min(nominalMm+DDR_RULES.caNominalToleranceMm,DDR_RULES.caMaximumLengthMm) : nominalMm;
    const skewMm = max-min;
    const skewPass = skewMm <= group.maxLengthSkew+eps;
    const absoluteLengthPass = min >= minimumMm-eps && max <= maximumMm+eps;
    const routingPass = members.every(m => m.routePass);
    if (!skewPass) failures.push(`${group.name}: ${skewMm.toFixed(4)} mm skew exceeds ${group.maxLengthSkew} mm`);
    if (!absoluteLengthPass) failures.push(`${group.name}: lengths ${min.toFixed(4)}–${max.toFixed(4)} mm outside ${minimumMm.toFixed(4)}–${maximumMm.toFixed(4)} mm`);
    return {name:group.name,memberCount:members.length,minLengthMm:min,maxLengthMm:max,skewMm,maxSkewMm:group.maxLengthSkew,nominalMm,minimumMm,maximumMm,skewPass,absoluteLengthPass,routingPass,pass:routingPass&&skewPass&&absoluteLengthPass};
  });
  const pairs = ddrPairs.map(pair => {
    const members = pair.signals.map(s => measurements.find(m => m.name === s)!);
    const skewMm = members.every(Boolean) ? Math.abs(members[0].lengthMm-members[1].lengthMm) : Infinity;
    const sameLayer = members.every(Boolean) && members[0].innerLayers.length===1 && members[0].innerLayers[0]===members[1].innerLayers[0];
    const pass = members.every(m => m?.routePass) && skewMm<=DDR_RULES.pairSkewMm+eps && sameLayer;
    if (!pass) failures.push(`${pair.name}: pair skew or carrier-layer check failed`);
    return {name:pair.name,skewMm,sameLayer,pass};
  });
  return {pass:failures.length===0,failures,groups,pairs,measurements,
    notVerified:["Fabricator stackup and controlled impedance", "Reference-plane continuity and return-current stitching", "Spacing/coupling geometry and native copper DRC", "Package/via flight times and unterminated CA/CK signal integrity"],
    fabricationReady:false};
}
