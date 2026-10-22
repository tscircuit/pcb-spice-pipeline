import type { CircuitJson } from './schema.js';
import type { IbisConversionMetadata } from '@tscircuit/ibis-to-spice';
import type { CircuitNodes, SimulationPlan } from './declarations.js';
import { type Geometry, type Modeling } from './geometry.js';
import { type ChannelMatrices } from './spice.js';
export interface ElectricalModel {
    name: string;
    spicePinMapping: Record<string, string>;
    metadata?: Pick<IbisConversionMetadata, 'pins'>;
}
export interface CompiledModel extends ElectricalModel {
    source: string;
}
export interface ElectricalSources {
    lines: string[];
    activeNodes: Set<string>;
    grounded: Set<string>;
    sourceBindings: Array<{
        name: string;
        positiveNode: string;
        negativeNode: string;
    }>;
    scope: {
        voltageSources: number;
        passiveComponents: number;
        unselectedBoardComponents: string;
    };
}
export declare function namespaceSpice(source: string, prefix: string): {
    source: string;
    wrapper: string;
};
export declare function electricalSources(circuit: CircuitJson, modeling: Modeling, nodes: CircuitNodes): ElectricalSources;
export interface SimulationSpiceOptions {
    reltol: number;
    abstol: number;
    method: 'gear' | 'trap';
    vntol?: number;
}
export declare function simulationSpiceOptions(overrides?: SimulationPlan['experiment']['spice_options'] | Record<string, unknown>): SimulationSpiceOptions;
export declare function generalSimulationSpice(plan: SimulationPlan, geometry: Geometry, modeling: Modeling, extracted: ChannelMatrices[], models: CompiledModel[], nodes: CircuitNodes, electrical: ElectricalSources): string;
export declare function validateProbeScope(plan: SimulationPlan, geometry: Geometry, models: ElectricalModel[], nodes: CircuitNodes, electrical: ElectricalSources): void;
