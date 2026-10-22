import type { SimulationIbisModel } from './schema.js';
export type IbisSources = Record<string, Uint8Array | string>;
/** Portable relative paths used by the explicit Node adapter as well as file maps. */
export declare function relativeFile(path: string): string;
export declare function loadModelSource(model: Pick<SimulationIbisModel, 'ibis_model_asset'> & {
    pipelineId: string;
}, sources: IbisSources): {
    text: string;
    bytes: Uint8Array<ArrayBufferLike>;
    evidence: {
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
};
