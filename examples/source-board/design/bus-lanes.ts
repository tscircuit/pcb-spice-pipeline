import { BusLanesPipelineSolver, type SimpleRouteJson, exteriorPairSpacingReports } from "@tscircuit/bus-lanes-solver";
import { auditDdrGeometry, signalNamesFromDeclaredBuses } from "./ddr-compliance";
import {compactRoutingInput} from './compact-routing-input';

/** Run the published 0.0.19 solver pinned by package-lock.json.
 * This custom algorithm does not use core's older bundled solver.
 * Pours are regenerated with antipads by tscircuit. Treating the entire GND
 * plane as a keepout would prohibit every through-via before routing starts.
 * All physical pads, holes, fixed tracks and vias remain routing obstacles.
 */
export async function ddrBusLanes(input: SimpleRouteJson) {
  const prepared = compactRoutingInput(structuredClone(input));
  prepared.obstacles = prepared.obstacles.filter((o) => !(o as typeof o & {isCopperPour?: boolean}).isCopperPour);
  prepared.allowedLayers = ["inner1", "inner2"];
  // Single-member buses only carried a layer restriction. The global restriction
  // above preserves it and lets unconstrained controls choose either inner layer.
  prepared.buses = prepared.buses?.filter((b) => b.connectionNames.length > 1);
  const names = signalNamesFromDeclaredBuses(prepared);
  const limits = auditDdrGeometry(prepared, [], names).groups;
  for (const bus of prepared.buses ?? []) {
    const limit = limits.find(group => group.name === (bus.name ?? bus.busId));
    if (!limit || limit.maximumMm === undefined || limit.minimumMm === undefined)
      throw new Error(`Cannot derive absolute length bounds for ${bus.busId}`);
    bus.maxLength = limit.maximumMm;
    bus.minLength = limit.minimumMm;
    bus.allowedLayers = ["inner1", "inner2"];
  }
  const solver = new BusLanesPipelineSolver(prepared, {
    maxSearchIterations: 2000000,
    maxLaneIterations: 1000000,
  });
  const handlers: Record<string, ((event: any) => void)[]> = {};
  const emit = (type: string, event: object) => handlers[type]?.forEach((fn) => fn({type, ...event}));
  const checkedTraces = () => {
    const audit = auditDdrGeometry(prepared, solver.traces, names);
    if (!audit.pass) throw new Error(`DDR timing acceptance failed: ${audit.failures.join("; ")}`);
    const coupling = exteriorPairSpacingReports(prepared, solver.traces);
    if (coupling.length !== 3 || coupling.some(pair => !pair.applicable || !pair.matched))
      throw new Error("DDR exterior pair coupling acceptance failed");
    return solver.traces;
  };
  return {
    input, isRouting: false,
    on(type: string, fn: (event: any) => void) { (handlers[type] ??= []).push(fn); },
    stop() {
      if (!this.isRouting) return;
      this.isRouting = false;
      // Preserve a verified solution when cancellation interrupts envelope
      // optimization. Strict board acceptance still gates the complete event.
      solver.tryFinalAcceptance();
      if (solver.solved) {
        try { emit("complete", {traces: checkedTraces()}); }
        catch (error) { emit("error", {error: error instanceof Error ? error : new Error(String(error))}); }
      }
    },
    async start() {
      this.isRouting = true;
      try {
        while (this.isRouting && !solver.solved && !solver.failed) {
          const until = performance.now() + 30;
          do { solver.step(); } while (!solver.solved && !solver.failed && performance.now() < until);
          emit("progress", {steps: solver.iterations, progress: solver.progress, phase: solver.phase});
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!this.isRouting) return;
        if (!solver.solved) solver.tryFinalAcceptance();
        if (!solver.solved) throw new Error(solver.error ?? "DDR bus_lanes failed");
        this.isRouting = false;
        emit("complete", {traces: checkedTraces()});
      } catch (error) {
        this.isRouting = false;
        emit("error", {error: error instanceof Error ? error : new Error(String(error))});
      }
    },
    solveSync() { solver.solve(); if (!solver.solved) solver.tryFinalAcceptance(); if (!solver.solved) throw new Error(solver.error ?? "DDR bus_lanes failed"); return checkedTraces(); },
  };
}
