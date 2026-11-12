import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { routeSectionDrawing, routeText, routeTextSize, type RoutedSections } from '../board'
import { rootScope, snapshot, sha256, type Produced } from '../kernel'
import { invoke, type SolverContext, type SolverRequest } from '../solver'
import { spiceProbeRows } from '../observation'
import { fail } from './diagnostics'
import { routeWaveformDrawing } from './waveform-visual'
import type { RoutedDeck, RoutedCapture } from './routed-types'

export interface RouteTransientInput { compiled: RoutedDeck; artifactPrefix: string; context: SolverContext; board?: RoutedSections }

/** Native batch writes complete ASCII raw vectors for the declarative transient deck. */
export function routedRequest(compiled: Pick<RoutedDeck, 'deck'>): SolverRequest & { outputFiles: ['waveform.raw'] } {
  return { solver: 'ngspice', files: { 'simulation.cir': compiled.deck }, args: ['-n', '-b', '-r', 'waveform.raw', 'simulation.cir'], outputFiles: ['waveform.raw'] }
}

/** One async step invokes ngspice once and admits only complete real probe waveforms. */
export class RouteTransientSolver extends BaseSolver {
  private output?: Produced<RoutedCapture>
  private running = false
  /** Execution is an injected capability, separate from the immutable deck input. */
  constructor(private readonly input: RouteTransientInput) { super() }
  /** Await the engine, then validate diagnostics and full coverage before publishing samples. */
  override async _stepAsync(): Promise<void> {
    const { compiled } = this.input
    const started = performance.now()
    this.stats = { invocations: 1, samples: 0, probes: 0 }
    this.input.context.progress(`Simulate ${compiled.name} (${compiled.probes.length} probes)`)
    const scope = rootScope('simulation').child(this.input.artifactPrefix)
    this.running = true
    try {
      const execution = await invoke(this.input.context, scope.child('solver').handTo('solver'), routedRequest(compiled))
      const run = execution.value
      const diagnostic = (run.stdout + '\n' + run.stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
      if (diagnostic) fail('native_solver', `${compiled.name}: ${diagnostic.trim()}`, { artifacts: run.logPaths })
      const rows = spiceProbeRows(run.outputs['waveform.raw'], compiled.probes)
      if (rows[0][0] < 0 || rows[0][0] > Math.max(compiled.stepSeconds, compiled.durationSeconds * 1e-8)) fail('simulation_start', `${compiled.name}: solver output omits the beginning of the transient`)
      if (Math.abs(rows.at(-1)![0] - compiled.durationSeconds) > compiled.durationSeconds * 1e-8) fail('simulation_duration', `${compiled.name}: solver did not complete the declared duration`)
      const value = snapshot({ kind: 'completed' as const, qualification: 'candidate-unqualified' as const, timestampsSeconds: rows.map(row => row[0]), probes: compiled.probes.map((probe, i) => ({ name: probe.name, sourcePortId: probe.signalSourceId, voltageLevels: rows.map(row => row[i + 1]) })) })
      this.output = { value, artifacts: [...execution.artifacts, scope.json('capture.json', { ...value, waveformSha256: sha256(run.outputs['waveform.raw']) })] }
      this.stats = { invocations: 1, samples: rows.length, probes: value.probes.length, elapsedMs: performance.now() - started }
      this.solved = true
    } finally {
      this.running = false
    }
  }
  /** Complete engine samples remain candidate evidence, without convergence qualification. */
  override getOutput(): Produced<RoutedCapture> {
    if (!this.output) throw new Error('Route transient is incomplete')
    return this.output
  }
  /** The runtime capability must be supplied again when constructing a new solver. */
  override getConstructorParams(): [RouteTransientInput] { return [this.input] }
  /** Use the parent pipeline's pure atlas renderer for actual live probe samples. */
  override visualize(): GraphicsObject {
    const capture = this.output?.value
    if (!capture) {
      const { compiled, board } = this.input
      const title = this.failed
        ? `6 · Transient failed: ${this.error}`
        : this.running
          ? '6 · Transient: running ngspice…'
          : '6 · Transient: compiled deck'
      const drawing: GraphicsObject = board
        ? routeSectionDrawing(board.circuitJson, board.geometry, board.scope, title)
        : { coordinateSystem: 'cartesian', texts: [], lines: [], rects: [] }
      if (!board) routeText(drawing, 2, 98, title, '#a16207', routeTextSize.title)
      if (this.failed) drawing.texts![0].color = '#dc2626'

      drawing.texts = drawing.texts!.filter((text) => text.y !== 87)
      routeText(
        drawing,
        2,
        87,
        `${compiled.probes.length} probes · ${(compiled.durationSeconds * 1e9).toFixed(2)} ns · ${compiled.deck.length} deck bytes`,
        '#475569',
      )
      routeText(
        drawing,
        2,
        81,
        this.failed ? 'No completed ngspice result' : this.running ? 'Running ngspice — no waveform data yet' : 'Deck ready — no waveform data yet',
        this.failed ? '#dc2626' : '#a16207',
      )
      return drawing
    }
    const routes = this.input.compiled.evidence.routes as { from: string; to: string }[] | undefined
    const labelled = capture && { ...capture, probes: capture.probes.map(probe => {
      const end = routes?.some(route => route.from === probe.sourcePortId) ? 'TX near' : routes?.some(route => route.to === probe.sourcePortId) ? 'RX far' : undefined
      return end ? { ...probe, name: `${probe.name} · ${end}` } : probe
    }) }
    return routeWaveformDrawing(labelled, this.input.compiled.durationSeconds, this.failed ? this.error ?? 'Transient failed' : undefined)
  }
}
