import { runPipeline } from '../../src'
import type { PipelineResult } from '../../src'

/** Empty public SI result for output-writing tests; no backend model or solver is required. */
export async function reportFixture(_options: unknown): Promise<PipelineResult> {
  return runPipeline({ circuitJson: [], ibisSources: {}, runSolver: async () => {
    throw new Error('unexpected solver')
  } })
}
