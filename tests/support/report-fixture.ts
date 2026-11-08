import { runPrepared } from '../../src/pipeline/prepared'
import type { PreparedOptions, PipelineResult } from '../../src/pipeline/result'

/** Adapt the pre-RFC canned stage fixture for report/IO regression tests only. */
export async function reportFixture(options: PreparedOptions): Promise<PipelineResult> {
  const result = await runPrepared(options)
  return { ...result, blocks: [{ simulationSignalIntegrityId: 'fixture', name: 'fixture', geometry: result.geometry, matrices: result.matrices,
    experiments: result.experiments, numericalSettings: result.modeling, results: [], limitations: result.limitations }] }
}
