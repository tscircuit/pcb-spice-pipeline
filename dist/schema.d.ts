import { z } from 'zod';
export { simulation_ibis_model, simulation_ibis_pin_state, simulation_digital_stimulus, simulation_eye_diagram, } from 'circuit-json';
export type { CircuitJson, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus, } from 'circuit-json';
import type { CircuitJson } from 'circuit-json';
export declare function recordSchema(record: {
    type: string;
    ftype?: string;
}): z.ZodTypeAny | undefined;
export declare function parseRecord(record: unknown): CircuitJson[number];
