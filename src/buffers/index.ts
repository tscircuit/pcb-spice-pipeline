/**
 * buffers — IBIS driver/receiver models as SPICE.
 * Owns: IbisSources admission (path safety, size, ZIP/HTML rejection, UTF-8), content hashes, the pinned @tscircuit/ibis-to-spice converter, compiled
 * libraries and their evidence.
 * Order (today's runPipeline): assertConverter -> admitBuffers (pure checks, no solver work) ->
 * compileBuffers -> per experiment ibisAssembly. compileBuffers takes AdmittedBuffers, so it cannot run on unchecked bytes.
 * Artifacts: inputs/ibis/<id>.ibs, vendor-sources.json, experiments/<id>/native-ibis-assembly.json.
 * The `<id>.lib` bytes are CompiledBuffer.source; simulation hands them to ngspice (solver records them).
 * Imports: kernel, board (types). (Was: model-source.ts, IBIS parts of general-pipeline.ts.)
 */
export type { IbisSources, ModelSourceRequest, ModelRunDefinition, SourceEvidence, LoadedModelSource, AdmittedBuffers, CompiledBuffer, AssemblyEntry } from './types'
export { relativeFile, loadModelSource } from './source'
export { assertConverter, admitBuffers, compileBuffers, ibisAssembly } from './buffers'
export { inspectPins, edgeSeconds, receiverThresholds, pinCapabilities, ibisNumber } from './inspect'
export type { InspectedPin } from './inspect'
