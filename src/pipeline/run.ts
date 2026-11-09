import { validateCircuitRecords } from '../board'
import { jsonBody, sha256 } from '../kernel'
import type { SolverResult } from '../solver'
import type { PipelineOptions, PipelineResult, BlockResult, PreparedResult } from './result'
import { prepareBlocks, extendRecording } from './signals'
import { runPrepared } from './prepared'
import { signalResults } from './results'
import { fail } from './diagnostics'

/** Run every Circuit JSON signal-integrity block independently with native solver IO. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  if ('modeling' in options) fail('signal_integrity_input', 'modeling has been removed; describe the test with <signalintegrity> and <signal>')
  validateCircuitRecords(options.circuitJson)
  const prepared = prepareBlocks(options.circuitJson, options.ibisSources)
  const blocks: BlockResult[] = []
  const files: Record<string, string> = {}
  const extractionRuns = new Map<string, { block: string; result: SolverResult }>()
  const executions: unknown[] = []
  for (const current of prepared) {
    let result: PreparedResult | undefined
    let results: BlockResult['results'] | undefined
    const refinements: unknown[] = []
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        result = await runPrepared({ ...options, circuitJson: current.circuit, modeling: current.settings, runSolver: async request => {
          const key = sha256(JSON.stringify(request))
          const previous = request.solver === 'ngspice' ? undefined : extractionRuns.get(key)
          executions.push({ block: current.block.simulation_signal_integrity_id, solver: request.solver, request_sha256: key, reused_from_block: previous?.block })
          if (previous) return structuredClone(previous.result)
          const result = await options.runSolver(request)
          if (request.solver !== 'ngspice') extractionRuns.set(key, { block: current.block.simulation_signal_integrity_id, result: structuredClone(result) })
          return result
        } })
        results = signalResults(current, result)
        break
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code === 'automatic_duration' && attempt < 7 && current.block.duration_s === undefined) {
          refinements.push({ attempt, code, duration_s: current.duration })
          extendRecording(current)
          options.onProgress?.(`Extending ${current.block.name ?? current.block.simulation_signal_integrity_id}: automatic strobe recording to ${current.duration}s`)
          continue
        }
        if (!['mesh_convergence', 'ground_mesh', 'cap_convergence'].includes(code ?? '') || attempt >= 4) throw error
        refinements.push({ attempt, code, message: (error as Error).message, settings: structuredClone(current.settings.extraction) })
        options.onProgress?.(`Refining ${current.block.name ?? current.block.simulation_signal_integrity_id}: ${code}`)
        const settings = current.settings.extraction
        settings.filaments = settings.refinementFilaments
        settings.refinementFilaments += 4
        settings.groundMeshMm! /= 2
        settings.maxPanelLengthMm /= 2
      }
    }
    if (!result || !results) throw new Error('Automatic native refinement failed to converge')
    const id = current.block.simulation_signal_integrity_id
    const prefix = `blocks/${id}`
    for (const [path, body] of Object.entries(result.files)) files[`${prefix}/${path}`] = body
    const experiments = result.experiments.map(run => ({ ...run, directory: `${prefix}/${run.directory}`, assemblyFile: `${prefix}/${run.assemblyFile}` }))
    files[`${prefix}/automatic-refinements.json`] = jsonBody(refinements)
    blocks.push({ simulationSignalIntegrityId: id, name: current.block.name ?? id, duration_s: current.duration, geometry: result.geometry, matrices: result.matrices, experiments,
      numericalSettings: current.settings, results, limitations: result.limitations })
  }
  const resultTypes = new Set(['simulation_signal_waveform', 'simulation_signal_eye', 'simulation_signal_crosstalk', 'simulation_signal_strobe_margin', 'simulation_signal_integrity_rlgc'])
  const results = [...options.circuitJson.filter(record => !resultTypes.has(record.type)), ...blocks.flatMap(block => block.results)]
  files['circuit-results.json'] = jsonBody(results)
  files['native-execution.json'] = jsonBody(executions)
  return { circuitJson: options.circuitJson, simulationResultCircuitJson: results, blocks, geometry: blocks[0]?.geometry, matrices: blocks[0]?.matrices ?? [],
    experiments: blocks.flatMap(block => block.experiments), limitations: [...new Set(blocks.flatMap(block => block.limitations))], files }
}
