import { BaseSolver } from '@tscircuit/solver-utils'
import { rootScope, snapshot, sha256, type Produced } from '../kernel'
import { emptyVisualization, invoke, type SolverContext, type SolverRequest } from '../solver'
import { parseSpiceVectors, spiceProbeRows } from '../observation'
import { routeSpatialWaveform } from './route-spatial'
import { fail } from './diagnostics'
import type { RoutedDeck, RoutedCapture } from './routed-types'

export interface RouteTransientInput { compiled: RoutedDeck; artifactPrefix: string; context: SolverContext }

/** Native batch writes complete ASCII raw vectors for the declarative transient deck. */
export function routedRequest(compiled: Pick<RoutedDeck, 'deck'>): SolverRequest & { outputFiles: ['waveform.raw'] } {
  return { solver: 'ngspice', files: { 'simulation.cir': compiled.deck }, args: ['-n', '-b', '-r', 'waveform.raw', 'simulation.cir'], outputFiles: ['waveform.raw'] }
}

/** One async step invokes ngspice once and admits only complete real probe waveforms. */
export class RouteTransientSolver extends BaseSolver {
  private output?: Produced<RoutedCapture>
  /** Execution is an injected capability, separate from the immutable deck input. */
  constructor(private readonly input: RouteTransientInput) { super() }
  /** Await the engine, then validate diagnostics and full coverage before publishing samples. */
  override async _stepAsync(): Promise<void> {
    const { compiled } = this.input
    const started = performance.now()
    this.stats = { invocations: 1, samples: 0, probes: 0 }
    this.input.context.progress(`Simulate ${compiled.name} (${compiled.probes.length} probes)`)
    const scope = rootScope('simulation').child(this.input.artifactPrefix)
    const execution = await invoke(this.input.context, scope.child('solver').handTo('solver'), routedRequest(compiled))
    const run = execution.value
    const diagnostic = (run.stdout + '\n' + run.stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
    if (diagnostic) fail('native_solver', `${compiled.name}: ${diagnostic.trim()}`, { artifacts: run.logPaths })
    const vectors = parseSpiceVectors(run.outputs['waveform.raw'])
    const rows = spiceProbeRows(vectors, compiled.probes)
    if (rows[0][0] < 0 || rows[0][0] > Math.max(compiled.stepSeconds, compiled.durationSeconds * 1e-8)) fail('simulation_start', `${compiled.name}: solver output omits the beginning of the transient`)
    if (Math.abs(rows.at(-1)![0] - compiled.durationSeconds) > compiled.durationSeconds * 1e-8) fail('simulation_duration', `${compiled.name}: solver did not complete the declared duration`)
    const value = snapshot({ kind: 'completed' as const, qualification: 'candidate-unqualified' as const, spatial: routeSpatialWaveform(compiled.spatialPoints, run.files['spatial.raw'] ? parseSpiceVectors(run.files['spatial.raw']) : vectors), timestampsSeconds: rows.map(row => row[0]), probes: compiled.probes.map((probe, i) => ({ name: probe.name, sourcePortId: probe.signalSourceId, voltageLevels: rows.map(row => row[i + 1]) })) })
    this.output = { value, artifacts: [...execution.artifacts, scope.json('capture.json', { ...value, waveformSha256: run.files['native-waveform.sha256'] ?? sha256(run.outputs['waveform.raw']) })] }
    this.stats = { invocations: 1, samples: rows.length, probes: value.probes.length, elapsedMs: performance.now() - started }
    this.solved = true
  }
  /** Complete engine samples remain candidate evidence, without convergence qualification. */
  override getOutput(): Produced<RoutedCapture> {
    if (!this.output) throw new Error('Route transient is incomplete')
    return this.output
  }
  /** The runtime capability must be supplied again when constructing a new solver. */
  override getConstructorParams(): [RouteTransientInput] { return [this.input] }
  /** Compatibility only; the physical scene is rendered from retained domain outputs. */
  override visualize = emptyVisualization
}
