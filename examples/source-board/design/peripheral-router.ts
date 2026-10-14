import { BusLanesPipelineSolver, pairLengthReports, exteriorPairSpacingReports, type SimpleRouteJson } from "@tscircuit/bus-lanes-solver";
import { compactRoutingInput } from "./compact-routing-input";
import { writeFileSync } from "node:fs";

/** Board-world points in mm, +X right and +Y up. Preserve fixed DDR copper;
 * use inner signal layers with only local top-pad escapes for new pairs. */
export async function peripheralBusLanes(input: SimpleRouteJson) {
  const prepared = compactRoutingInput(structuredClone(input));
  prepared.obstacles = prepared.obstacles.filter(o => !(o as any).isCopperPour);
  prepared.allowedLayers = ["inner1", "inner2"];
  writeFileSync("output/peripheral-pairs.srj.json", JSON.stringify(prepared));
  const solver = new BusLanesPipelineSolver(prepared, { maxSearchIterations: 2_000_000, maxLaneIterations: 1_000_000 });
  const handlers: Record<string, ((event: any) => void)[]> = {};
  const emit = (type: string, event: object) => handlers[type]?.forEach(fn => fn({ type, ...event }));
  const finish = () => {
    solver.tryFinalAcceptance();
    if (!solver.solved) throw new Error(solver.error ?? "Peripheral pair routing did not complete");
    const pairs = pairLengthReports(prepared, solver.traces);
    const coupling = exteriorPairSpacingReports(prepared, solver.traces);
    writeFileSync("output/peripheral-pairs.result.json", JSON.stringify({ solved: solver.solved, pairs, coupling, traces: solver.traces }, null, 2));
    if (solver.traces.length !== prepared.connections.length || pairs.some(p => !p.matched) || coupling.some(p => p.applicable && !p.matched))
      throw new Error("Peripheral pairs failed complete routing, skew, or coupling validation");
    return solver.traces;
  };
  return {
    input, isRouting: false,
    on(type: string, fn: (event: any) => void) { (handlers[type] ??= []).push(fn); },
    stop() { this.isRouting = false; solver.tryFinalAcceptance(); },
    async start() {
      this.isRouting = true;
      const started = performance.now(); let nextLog = started + 15000;
      try {
        while (this.isRouting && !solver.solved && !solver.failed && performance.now() - started < 300000) {
          const until = performance.now() + 30;
          do { solver.step(); } while (!solver.solved && !solver.failed && performance.now() < until);
          if (performance.now() > nextLog) { console.log(JSON.stringify({ router: "peripheral_bus_lanes", phase: solver.phase, iterations: solver.iterations, seconds: (performance.now() - started) / 1000 })); nextLog += 15000; }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (!this.isRouting) return;
        this.isRouting = false;
        emit("complete", { traces: finish() });
      } catch (error) { this.isRouting = false; emit("error", { error }); }
    },
    solveSync() { solver.solve(); return finish(); },
  };
}
