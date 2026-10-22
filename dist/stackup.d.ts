import { type CircuitJson } from 'circuit-json';
export declare const defaultCopperConductivitySm = 58000000;
export interface CopperLayer {
    name: string;
    zMinMm: number;
    zMaxMm: number;
    conductivitySm: number;
}
export interface DielectricLayer {
    material?: string;
    zMinMm: number;
    zMaxMm: number;
    relativePermittivity?: number;
}
export interface BoardStackup {
    pcbBoardId: string;
    copperLayers: CopperLayer[];
    dielectrics: DielectricLayer[];
    relativePermittivity?: number;
    viaPlatingMm?: number;
}
/** Circuit JSON is top→bottom; solver z=0 is the upper face of bottom copper. */
export declare function stackupFromCircuitJson(circuit: CircuitJson): BoardStackup;
