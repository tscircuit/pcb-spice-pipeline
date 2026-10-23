import type { CircuitJson } from './schema.js';
import type { PipelineModeling } from './general-pipeline.js';
/** Read raw channel declarations, independently of the installed Circuit JSON schema. */
export declare function modelingFromCircuitJson(circuitJson: CircuitJson): PipelineModeling;
