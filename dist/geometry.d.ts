import { type BoardStackup, type CopperLayer } from './stackup.js';
import type { CircuitJson } from './schema.js';
import type { RoutedCopper } from './copper.js';
import type { DdrAssessmentConfig } from './ddr.js';
export type PortSelector = {
    sourcePortId: string;
    component?: never;
    port?: never;
} | {
    sourcePortId?: never;
    component: string;
    port: string;
};
export interface ExtractionSettings {
    minimumHz: number;
    maximumHz: number;
    modelHz: number;
    filaments: number;
    refinementFilaments: number;
    convergenceTolerance: number;
    capTolerance: number;
    maxPanelLengthMm: number;
    reciprocityTolerance: number;
    dcResistanceTolerance: number;
    groundMeshMm?: number;
}
export interface Modeling {
    ddrAssessments?: DdrAssessmentConfig[];
    reduction: 'straightened-stages' | 'routed-copper';
    sections: number;
    relativePermittivity?: number;
    groundReturn?: PortSelector;
    lanes: {
        port: string;
        from: PortSelector;
        to: PortSelector;
        sourceTraceId?: string;
        driverPort?: string;
        receiverPort?: string;
    }[];
    profiles?: Record<string, {
        spacingMm: number;
        relativePermittivity: number;
        return: {
            widthMm: number;
            thicknessMm: number;
            lengthFactor: number;
            centerYMm: number;
            centerZMm: number;
        };
    }>;
    extraction: ExtractionSettings;
    viaPlatingMm?: number;
    viaEquivalentWidthMm?: number;
    omitThroughViaStubs?: boolean;
    channelReference?: PortSelector;
    supplies?: {
        positive: PortSelector;
        negative: PortSelector;
        voltageV: number;
    }[];
    passiveComponents?: {
        sourceComponentId?: string;
        component?: string;
    }[];
    description?: string;
}
export interface ResolvedModeling extends Modeling {
    conductivitySm: number;
    stackup: CopperLayer[];
}
export interface RouteStage {
    kind: 'wire' | 'via';
    profile: string;
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
    conductivitySm?: number;
    holeMm?: number;
    platingMm?: number;
}
type SourcePort = Extract<CircuitJson[number], {
    type: 'source_port';
}>;
type RoutePoint = Extract<CircuitJson[number], {
    type: 'pcb_trace';
}>['route'][number];
type RoutedPoint = Exclude<RoutePoint, {
    route_type: 'through_pad';
}> & {
    via_hole_diameter?: number;
};
export interface LaneMapping {
    port: string;
    sourceTraceId: string;
    pcbTraceId: string;
    from: string;
    to: string;
    pcbPorts: string[];
    stages: RouteStage[];
    originalRoute: RoutedPoint[];
}
export interface GeometryCell {
    stage: number;
    profile: string;
    relativePermittivity: number;
    conductivitySm: number;
    conductors: {
        name: string;
        lengthM: number;
        widthM: number;
        thicknessM: number;
        yM: number;
        zM: number;
        conductivitySm?: number;
    }[];
    routedCopper?: RoutedCopper;
}
export interface Geometry {
    stackup?: BoardStackup;
    cells: GeometryCell[];
    mappings: LaneMapping[];
    units: {
        circuitJson: 'mm';
        geometry: 'm';
        conductivity: 'S/m';
    };
    approximations: string[];
}
export declare function validateModeling(m: Modeling): void;
export declare function selectPort(cj: CircuitJson, s: PortSelector | undefined): SourcePort;
export declare function geometryFromCircuitJson(cj: CircuitJson, modeling: Modeling): Geometry;
export declare function fastHenryDeck(cell: GeometryCell, extraction: ExtractionSettings): string;
export declare function fasterCapDeck(cell: GeometryCell, extraction: ExtractionSettings): Record<string, string>;
export {};
