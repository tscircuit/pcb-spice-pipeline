import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { rootScope, snapshot, sha256, type ArtifactScope, type Produced } from '../kernel'
import { invoke, type SolverContext, type SolverRequest } from '../solver'
import { probeWaveformRows } from '../observation'
import { fail } from './diagnostics'
import { routeWaveformDrawing } from './waveform-visual'
import type { RoutedDeck, RoutedExecution, RoutedCapture } from './routed-types'

export interface RouteCaptureInput {
  compiled: RoutedDeck
  execution?: RoutedExecution
  artifactPrefix: string
}

/** The single native request constructor, also used to identify the compiled request. */
export function routedRequest(compiled: Pick<RoutedDeck, 'deck'>): SolverRequest & { outputFiles: ['waveform.dat'] } {
  return { solver: 'ngspice', files: { 'simulation.cir': compiled.deck }, args: ['-n', '-b', 'simulation.cir'], outputFiles: ['waveform.dat'] }
}

let nativeTail: Promise<void> = Promise.resolve()
/** Async serial execution outside synchronous solver steps, behind the existing RunSolver port. */
export async function executeRoutedDeck(ctx: SolverContext, compiled: RoutedDeck, scope: ArtifactScope): Promise<Produced<RoutedExecution>> {
  const previous = nativeTail
  let release!: () => void
  nativeTail = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    ctx.progress(`Simulate ${compiled.name} (${compiled.probes.length} probes)`)
    const output = await invoke(ctx, scope.handTo('solver'), routedRequest(compiled))
    return { value: { requestSha256: compiled.requestSha256, run: output.value }, artifacts: output.artifacts }
  } finally {
    release()
  }
}

/** Parse a completed headless native result, one probe per step; no recording loader. */
export class RouteCaptureSolver extends BaseSolver {
  private rows?: number[][]
  private readonly probes: Extract<RoutedCapture, { kind: 'completed' }>['probes'] = []
  private output?: Produced<RoutedCapture>
  /** A missing execution is an explicit native-not-run state. */
  constructor(private readonly input: RouteCaptureInput) { super() }
  /** Validate diagnostics and finite complete coverage before exposing any probe. */
  override _step(): void {
    const { compiled, execution } = this.input
    if (!execution) {
      this.output = { value: snapshot({ kind: 'not-run' }), artifacts: [] }
      this.stats = { nativeInvocations: 0, samples: 0, probes: 0 }
      this.solved = true
      return
    }
    if (!this.rows) {
      if (execution.requestSha256 !== compiled.requestSha256) throw new Error('Native result belongs to a different routed deck')
      const run = execution.run
      const diagnostic = (run.stdout + '\n' + run.stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
      if (diagnostic) fail('native_solver', `${compiled.name}: ${diagnostic.trim()}`, { artifacts: run.logPaths })
      this.rows = probeWaveformRows(run.outputs['waveform.dat'], compiled.probes)
      if (this.rows[0][0] < 0 || this.rows[0][0] > Math.max(compiled.stepSeconds, compiled.durationSeconds * 1e-8)) fail('simulation_start', `${compiled.name}: solver output omits the beginning of the declared recording`)
      if (Math.abs(this.rows.at(-1)![0] - compiled.durationSeconds) > compiled.durationSeconds * 1e-8) fail('simulation_duration', `${compiled.name}: native solver did not complete the declared duration`)
    }
    const i = this.probes.length
    const probe = compiled.probes[i]
    if (probe) this.probes.push({ name: probe.name, sourcePortId: probe.signalSourceId, voltageLevels: this.rows.map(row => row[i + 1]) })
    this.stats = { nativeInvocations: 1, samples: this.rows.length, probes: this.probes.length }
    if (this.probes.length !== compiled.probes.length) return
    const value = snapshot({ kind: 'completed' as const, qualification: 'candidate-unqualified' as const, timestampsSeconds: this.rows.map(row => row[0]), probes: this.probes })
    const scope = rootScope('simulation').child(this.input.artifactPrefix)
    this.output = { value, artifacts: [scope.json('capture.json', { ...value, waveformSha256: sha256(execution.run.outputs['waveform.dat']) })] }
    this.solved = true
  }
  /** Complete native samples are candidate evidence, never RFC acceptance. */
  override getOutput(): Produced<RoutedCapture> {
    if (!this.output) throw new Error('Route capture is incomplete')
    return this.output
  }
  /** The caller supplies the completed result directly; no browser replay transport. */
  override getConstructorParams(): [RouteCaptureInput] { return [this.input] }
  /** Actual probe polylines in the waveform atlas, or a native-not-run banner. */
  override visualize(): GraphicsObject {
    return routeWaveformDrawing(this.output?.value, this.input.compiled.durationSeconds, this.failed ? (this.error ?? 'Native capture failed') : undefined)
  }
}
