// Vendor model admission, conversion and assembly evidence.
import * as converter from '@tscircuit/ibis-to-spice'
import { sha256, type Artifact, type ArtifactScope, type Produced } from '../kernel'
import { fail } from './diagnostics'
import { loadModelSource } from './source'
import { convertPackaged } from './package'
import type { AdmittedBuffers, AssemblyEntry, CompiledBuffer, IbisSources, LoadedModelSource, ModelRunDefinition, ModelSourceRequest } from './types'

/**
 * Load every used model before any solver work, in
 * declaration order. Artifacts (under `scope`, the output root): inputs/ibis/<pipelineId>.ibs and
 * vendor-sources.json, byte-identical to today.
 */
export function admitBuffers(models: readonly ModelSourceRequest[], ibisSources: IbisSources, _modeling: object, scope: ArtifactScope): Produced<AdmittedBuffers> {
  const loaded = models.map(model => loadModelSource(model, ibisSources))
  const artifacts: Artifact[] = loaded.map(source => scope.text(source.evidence.ibsFile, source.text))
  artifacts.push(scope.json('vendor-sources.json', loaded.map(source => source.evidence)))
  return { value: { models: models.map(model => ({ pipelineId: model.pipelineId })), sources: loaded } as unknown as AdmittedBuffers, artifacts }
}

/**
 * Convert each plan's models (plan order, then model order), exactly as today: `define` builds the
 * converter input (simulation's modelRunDefinition), its source is pinned to the admitted bytes,
 * then convertIbisModelToSpice runs. Pure; converter errors propagate unchanged.
 */
export function compileBuffers<M extends { pipelineId: string; ibis_component_name: string }, P extends { readonly models: readonly M[] }>(
  admitted: AdmittedBuffers, plans: readonly P[], define: (model: M, plan: P) => ModelRunDefinition): CompiledBuffer[][] {
  return plans.map(plan => plan.models.map(model => {
    const index = admitted.models.findIndex(selected => selected.pipelineId === model.pipelineId)
    const input = define(model, plan)
    const source = admitted.sources[index]
    input.definition.source = { file: source.evidence.ibsFile, sha256: source.evidence.sourceSha256 }
    const result = convertPackaged(source.bytes, input, source.evidence.ibisModelAsset.project_relative_path)
    return { ...result, name: model.ibis_component_name, pipelineId: model.pipelineId, input, sourceEvidence: admitted.sources[index].evidence }
  }))
}

/** One experiment's assembly evidence. Artifact: native-ibis-assembly.json under `experiment` (experiments/<id>). */
export function ibisAssembly(models: readonly CompiledBuffer[], experiment: ArtifactScope): Produced<AssemblyEntry[]> {
  const assembly: AssemblyEntry[] = models.map(model => ({
    simulationIbisModelId: model.pipelineId, definition: model.input.definition, run: model.input.run, spicePinMapping: model.spicePinMapping,
    sourceSha256: model.sourceSha256, spiceSha256: sha256(model.source), sourceEvidence: model.sourceEvidence, metadata: model.metadata, warnings: model.warnings,
  }))
  return { value: assembly, artifacts: [experiment.json('native-ibis-assembly.json', assembly)] }
}
