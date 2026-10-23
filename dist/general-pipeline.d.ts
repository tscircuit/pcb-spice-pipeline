import * as converter from '@tscircuit/ibis-to-spice';
import type { CircuitJson } from './schema.js';
import { type Modeling } from './geometry.js';
import { type IbisSources } from './model-source.js';
import { type FileMap, type RunSolver } from './solver.js';
export type PipelineModeling = Modeling & {
    ibisModelAssetSha256?: Record<string, string>;
};
export interface PipelineOptions {
    circuitJson: CircuitJson;
    modeling?: PipelineModeling;
    ibisSources: IbisSources;
    runSolver: RunSolver;
    onProgress?: (message: string) => void;
}
/** Deterministic orchestration. All external execution belongs to the supplied callback. */
export declare function runPipeline({ circuitJson, modeling, ibisSources, runSolver, onProgress }: PipelineOptions): Promise<{
    circuitJson: CircuitJson;
    simulationResultCircuitJson: CircuitJson;
    modeling: PipelineModeling;
    geometry: import("./geometry.js").Geometry;
    matrices: {
        stage: number;
        profile: string;
        R: number[][];
        L: number[][];
        C: number[][];
        units: {
            R: string;
            L: string;
            C: string;
        };
        frequencyHz: number;
        primitiveOrder: string[];
        primitiveImpedance: import("./extraction.js").ImpedanceSample[];
        modelPrimitiveImpedance: import("./extraction.js").ImpedanceSample;
        primitiveCapacitance: number[][];
        checks: {
            R: import("./extraction.js").MatrixCheck;
            L: import("./extraction.js").MatrixCheck;
            C: import("./extraction.js").CapacitanceCheck;
            primitiveC: import("./extraction.js").MatrixCheck;
            convergence: import("./extraction.js").RefinementCheck;
            capConvergence: number;
            analyticResistanceOhm: number[];
            analyticResistanceRelativeErrors: number[];
            analyticFrequencyHz: number;
            analyticLoopResistanceOhm: number[][] | null;
            dcLoopResidual: number | null;
            energyResidual: number;
            neutralityResidual: number;
        };
        conversions: {
            impedance: string;
            capacitance: string;
            capacitanceSolverCoordinateUnits: string;
            capacitanceScaleToFarads: number;
            neutralityDenominatorF: number;
        };
    }[];
    experiments: {
        plan: import("./declarations.js").SimulationPlan;
        waveform: {
            timeUnit: "s";
            voltageUnit: "V";
            rows: number[][];
        };
        simulationExperimentId: string;
        name: string;
        directory: string;
        durationSeconds: number;
        startTimeSeconds: number;
        maxStepSeconds: number;
        probes: import("./declarations.js").VoltageProbePlan[];
        eyes: {
            samples: number[][];
            alignment: string;
            ddrAssessment: import("./ddr.js").DdrAssessment | undefined;
            directory: string;
            windows: number;
            pointsPerWindow: number;
            windowOriginsSeconds: any[];
            boundaryIndices: number[];
            interpolation: string;
            windowDefinition: string;
            source: string;
            sourceSha256: string;
            metrics: {
                kind: string;
                alignment: string;
                samples: any;
                voltageRangeV: any;
                unitIntervalSeconds: any;
                timeOriginSeconds: any;
                measurementStartSeconds: any;
                measurementEndSeconds: any;
                observedStartSeconds: any;
                observedEndSeconds: any;
                windows: number;
                limitations: string[];
            };
            simulationEyeDiagramId: string;
            name: string;
            simulationExperimentId: string;
            simulationVoltageProbeId: string;
            column: number;
            unitIntervalSeconds: number;
            timeOriginSeconds: number;
            startTimeSeconds: number;
            endTimeSeconds: number;
        }[];
        solverInvocations: number;
        waveformSamples: number;
        assembly: {
            simulationIbisModelId: string;
            definition: converter.IbisModelDefinition;
            run: converter.IbisRunConfig;
            spicePinMapping: Record<string, string>;
            sourceSha256: string | undefined;
            spiceSha256: string;
            sourceEvidence: {
                simulationIbisModelId: string;
                ibisModelAsset: {
                    project_relative_path: string;
                    url: string;
                    mimetype: string;
                };
                resolvedFrom: "provided";
                ibsFile: string;
                sourceSha256: string;
                rawSourceFile: string;
                rawSourceSha256: string;
            };
            metadata: converter.IbisConversionMetadata;
            warnings: string[];
        }[];
        assemblyFile: string;
    }[];
    limitations: string[];
    files: FileMap;
}>;
export type PipelineResult = Awaited<ReturnType<typeof runPipeline>>;
