import type { CircuitJson } from './schema.js';
import type { Geometry, Modeling } from './geometry.js';
import type { SimulationPlan } from './declarations.js';
import type { DdrAssessment } from './ddr.js';
export type ReportTest = Pick<SimulationPlan, 'startTimeSeconds' | 'durationSeconds' | 'maxStepSeconds' | 'stimuli' | 'states' | 'models'>;
export interface ReportContext {
    description?: string;
    ports: Record<string, string>;
    lanes: Array<{
        name: string;
        from: string;
        to: string;
        sourceTraceId: string;
        pcbTraceId: string;
        lengthMm: number;
        layers: string[];
        widthsMm: number[];
        vias: number;
        route: Array<{
            x: number;
            y: number;
        }>;
    }>;
    settings: Array<[string, string]>;
    board?: {
        bounds: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        };
        outlines: Array<{
            x: number;
            y: number;
            width: number;
            height: number;
        }>;
        outlinePaths: string[];
        traces: Array<{
            id: string;
            path: string;
        }>;
        components: Array<{
            id: string;
            name: string;
            x: number;
            y: number;
            width: number;
            height: number;
            used: boolean;
        }>;
    };
}
export interface ReportProbe {
    name: string;
    column: number;
    simulationVoltageProbeId?: string;
    signalSourceId?: string;
    referenceSourceId?: string | null;
    signalLabel?: string;
    referenceLabel?: string;
}
export interface ReportEye {
    name: string;
    simulationVoltageProbeId?: string;
    unitIntervalSeconds: number;
    startTimeSeconds?: number;
    endTimeSeconds?: number;
    timeOriginSeconds?: number;
    windows?: number;
    windowOriginsSeconds?: number[];
    csv?: string;
    alignment?: string;
    ddrAssessment?: DdrAssessment;
    metrics?: {
        voltageRangeV: number[];
    };
}
export interface ReportRun {
    name: string;
    rows: number[][];
    probes: ReportProbe[];
    eyes: ReportEye[];
    test?: ReportTest;
}
export interface ReportChange {
    quiet: string;
    active: string;
    peakAbsoluteV: number;
    timeRmsV: number;
    startSeconds: number;
    endSeconds: number;
}
export interface ReportData {
    runs: ReportRun[];
    limitations: string[];
    context?: ReportContext;
    changes?: ReportChange[];
    comparisonProbeName?: string;
}
export interface ReportFile {
    path: string;
    label: string;
    description: string;
    content: string;
}
export declare const html: (value: unknown) => string;
export declare const number: (value: number | undefined, unit?: string, scale?: number) => string;
export declare function reportContext(circuit: CircuitJson, geometry: Geometry, modeling: Modeling): ReportContext;
export declare function reportFiles(data: ReportData): ReportFile[];
export declare function reportSections(data: ReportData, files: ReportFile[]): {
    traces: string;
    plan: string;
    findings: string;
    settings: string;
    downloads: string;
};
