// The per-experiment ngspice part of general-pipeline.ts runPipeline, plus the plan-level checks
// it performed around declarations. Messages, artifact paths and bytes unchanged.
import { safeId, sha256, type Artifact, type ArtifactScope, type Produced } from '../kernel'
import { invoke, type SolverContext } from '../solver'
import { type Geometry } from '../board'
import { probeWaveformRows } from '../observation'
import type { StageMatrices } from '../extraction'
import { fail } from './diagnostics'
import { generalSimulationSpice, validateProbeScope } from './netlist'
import type { BoundExperiments, CircuitNodes, ElectricalSources, ExperimentModel, ExperimentResult, ExperimentRun, Experiments, SafeSimulationPlan, SimulationPlan } from './types'

/** Validate experiment identifiers before they become artifact paths. */
export function safeSimulationPlans(plans: SimulationPlan[]): SafeSimulationPlan[] {
  for (const plan of plans) {
    safeId(plan.simulationExperimentId, 'simulationExperimentId')
  }
  return plans as unknown as SafeSimulationPlan[]
}

/** electrical-node-map.json, written under `scope` (the output root). */
export function electricalNodeMap(nodes: CircuitNodes, electrical: ElectricalSources, scope: ArtifactScope): Artifact {
  return scope.json('electrical-node-map.json', { nodes: nodes.mapping, channelReferenceSourcePortId: nodes.groundSourcePortId, scope: electrical.scope })
}

/** Validate every plan's probe scope against its compiled models (today's preflight before any file or solver work). */
export function bindExperiments<M extends ExperimentModel>(experiments: Experiments, geometry: Pick<Geometry, 'mappings'>, compiled: readonly (readonly M[])[]): BoundExperiments<M> {
  for (const [i, plan] of experiments.plans.entries()) validateProbeScope(plan, geometry, compiled[i], experiments.nodes, experiments.electrical)
  return { ...experiments, compiled } as unknown as BoundExperiments<M>
}

/**
 * Run plans[index] in ngspice under `experiment` (experiments/<id>). Artifacts: experiment.json,
 * the solver's <pipelineId>.lib / simulation.cir / waveform.dat / ngspice.{stdout,stderr}.log /
 * ngspice.request.json, waveform.csv, waveform.json.
 * ngspice can recover a singular operating point through gmin/source stepping; those warnings are
 * accepted only when a complete finite transient follows.
 */
export async function runExperiment(ctx: SolverContext, experiment: ArtifactScope, bound: BoundExperiments, index: number,
  geometry: Pick<Geometry, 'mappings'>, modeling: { sections: number }, extracted: readonly StageMatrices[]): Promise<Produced<ExperimentRun>> {
  const plan = bound.plans[index]
  const models = bound.compiled[index]
  const artifacts: Artifact[] = []
  const solverFiles: Record<string, string> = Object.create(null)
  for (const model of models) solverFiles[`${safeId(model.pipelineId, 'simulationIbisModelId')}.lib`] = model.source
  artifacts.push(experiment.json('experiment.json', plan))
  solverFiles['simulation.cir'] = generalSimulationSpice(plan, geometry, modeling, extracted, models, bound.nodes, bound.electrical)
  ctx.progress(`Simulate ${plan.name} (${plan.probes.length} probes)`)
  const solve = await invoke(ctx, experiment, { solver: 'ngspice', files: solverFiles, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
  const run = solve.value
  const diagnostic = (run.stdout + '\n' + run.stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
  if (diagnostic) fail('native_solver', `${plan.name}: ${diagnostic.trim()}`, { subjects: [{ kind: 'experiment', id: plan.simulationExperimentId }], artifacts: run.logPaths })
  artifacts.push(...solve.artifacts)
  const waveformText = run.outputs['waveform.dat']
  const rows: number[][] = probeWaveformRows(waveformText, plan.probes)
  if (rows[0][0] > plan.startTimeSeconds + Math.max(plan.maxStepSeconds, plan.durationSeconds * 1e-8)) fail('simulation_start', `${plan.name}: solver output omits the beginning of the declared recording`)
  if (Math.abs(rows[rows.length - 1][0] - plan.durationSeconds) > plan.durationSeconds * 1e-8) fail('simulation_duration', `${plan.name}: native solver did not complete the declared duration`)
  const csv = 'time_s,' + plan.probes.map(probe => probe.simulationVoltageProbeId + '_v').join(',') + '\n' + rows.map(row => row.join(',')).join('\n') + '\n'
  artifacts.push(experiment.text('waveform.csv', csv))
  artifacts.push(experiment.json('waveform.json', { simulationExperimentId: plan.simulationExperimentId, probes: plan.probes, samples: rows.length, timestamps: 'actual adaptive solver times in seconds', source: 'waveform.dat', sourceSha256: sha256(waveformText) }))
  return { value: { plan, directory: experiment.prefix, rows, waveformCsvSha256: sha256(csv) }, artifacts }
}

/** Today's PipelineResult.experiments[] entry for one run. */
export function experimentResult<A>(run: ExperimentRun, assembly: A[]): ExperimentResult<A> {
  const { plan, directory: relative, rows } = run
  return { plan, waveform: { timeUnit: 's', voltageUnit: 'V', rows }, simulationExperimentId: plan.simulationExperimentId, name: plan.name, directory: relative, durationSeconds: plan.durationSeconds, startTimeSeconds: plan.startTimeSeconds, maxStepSeconds: plan.maxStepSeconds, probes: plan.probes, solverInvocations: 1, waveformSamples: rows.length, assembly, assemblyFile: relative + '/native-ibis-assembly.json' }
}

/** Solve the same circuit's undisturbed DC point with all aggressors held at their initial levels. */
export async function runIdle(ctx: SolverContext, scope: ArtifactScope, bound: BoundExperiments, index: number,
  geometry: Pick<Geometry, 'mappings'>, modeling: { sections: number }, extracted: readonly StageMatrices[]): Promise<Produced<number[]>> {
  const original = bound.plans[index]
  const duration = Math.max(...original.stimuli.map(s => s.start_time_ms / 1000 + 16 * s.bit_duration_ms / 1000), original.durationSeconds / 100)
  const plan = { ...original, durationSeconds: duration, maxStepSeconds: duration / 2000 }
  const files = { 'simulation.cir': generalSimulationSpice(plan, geometry, modeling, extracted, bound.compiled[index], bound.nodes, bound.electrical) }
  const solve = await invoke(ctx, scope, { solver: 'ngspice', files, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
  const output = solve.value
  if (/(?:error|fatal|no convergence|operating point failed)/i.test(output.stdout + output.stderr)) throw new Error('Floating quiet victim has no undisturbed idle operating point.')
  const rows = probeWaveformRows(output.outputs['waveform.dat'], plan.probes)
  const last = rows.at(-1)!
  const idle = last.slice(1)
  for (const row of rows) if (row[0] >= duration * .9 && idle.some((value, i) => Math.abs(row[i + 1] - value) > 1e-5)) throw new Error('Undisturbed idle transient did not settle to a unique operating point')
  const artifacts = [...solve.artifacts, scope.json('idle-voltages.json', { duration_s: duration, voltage_levels: idle })]
  const disabled = original.states.filter(state => state.is_output && !state.is_output_enabled)
  if (disabled.length) {
    // Capacitive off victims can appear stable solely because ngspice picked an arbitrary initial charge.
    const initial = disabled.map(state => `v(${bound.nodes.node(state.source_port_id)})=1`).join(' ')
    const alternateFiles = { 'simulation.cir': files['simulation.cir'].replace('.control', `.ic ${initial}\n.control`) }
    const alternate = await invoke(ctx, scope.child('alternate-initial-charge'), { solver: 'ngspice', files: alternateFiles, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
    artifacts.push(...alternate.artifacts)
    if (/(?:error|fatal|no convergence|operating point failed)/i.test(alternate.value.stdout + alternate.value.stderr)) throw new Error('Floating quiet victim has no undisturbed idle operating point.')
    const last = probeWaveformRows(alternate.value.outputs['waveform.dat'], plan.probes).at(-1)!
    if (idle.some((value, i) => Math.abs(last[i + 1] - value) > 1e-5)) throw new Error('Floating quiet victim has no undisturbed idle operating point.')
  }
  return { value: idle, artifacts }
}
