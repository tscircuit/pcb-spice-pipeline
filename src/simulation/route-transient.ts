import { BaseSolver } from '@tscircuit/solver-utils'
import { routeDot, routeNetColors, routePortColor, routeSourceColors, boardBounds, routePortPoint, routeSectionDrawing, routeTextSize, routeTitle, routeUnion, type RoutedSections, type StageDrawing } from '../board'
import { rootScope, snapshot, sha256, type Produced } from '../kernel'
import { invoke, type SolverContext, type SolverRequest } from '../solver'
import { spiceProbeRows } from '../observation'
import { fail } from './diagnostics'
import { routeWaveformDrawing, type RouteLimit } from './waveform-visual'
import type { RoutedDeck, RoutedCapture } from './routed-types'

export interface RouteTransientInput {
  compiled: RoutedDeck
  artifactPrefix: string
  context: SolverContext
  board?: RoutedSections
  /** Display-only receiver thresholds; never enter the deck. */
  limits?: RouteLimit[]
}

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
  /** Probe dots on the board share their curve's colour in the waveform panel below; the camera moves to the panel once samples exist. */
  override visualize(): StageDrawing {
    const { compiled, board } = this.input
    const capture = this.output?.value
    const routes = compiled.evidence.routes as { from: string; to: string }[] | undefined
    const labelled = capture && { ...capture, probes: capture.probes.map(probe => {
      const end = routes?.some(route => route.from === probe.sourcePortId) ? 'TX near' : routes?.some(route => route.to === probe.sourcePortId) ? 'RX far' : undefined
      return end ? { ...probe, name: `${probe.name} · ${end}` } : probe
    }) }
    const drawing: StageDrawing = board ? routeSectionDrawing(board.circuitJson, board.geometry, board.scope) : { coordinateSystem: 'cartesian', lines: [], texts: [] }
    const extent = board ? boardBounds(board.circuitJson) : { minX: 0, maxX: 300, minY: 140, maxY: 140 }
    const width = extent.maxX - extent.minX
    const panel = { minX: extent.minX, maxX: extent.maxX, minY: extent.minY - width * 0.53, maxY: extent.minY - width * 0.08 }
    const sourceColors = board ? routeSourceColors(board.geometry, board.scope) : new Map<string, string>()
    const colors = compiled.probes.map((probe, i) => (board && routePortColor(board.circuitJson, sourceColors, probe.signalSourceId)) || routeNetColors[i % routeNetColors.length])
    if (capture || this.failed || !board) drawing.focus = board ? routeUnion(panel, drawing.focus!) : { ...panel, maxY: panel.maxY + width * 0.06 }
    const waveform = routeWaveformDrawing(labelled, compiled.durationSeconds, panel, {
      error: this.failed ? (this.error ?? 'Transient failed') : undefined,
      limits: this.input.limits,
      colors,
      textSize: routeTextSize(drawing.focus!).body,
    })
    drawing.lines!.push(...waveform.lines!)
    drawing.texts = [...drawing.texts ?? [], ...waveform.texts!]
    if (board) {
      const size = routeTextSize(drawing.focus!).body
      for (const [i, probe] of compiled.probes.entries())
        for (const point of [routePortPoint(board.circuitJson, probe.signalSourceId)].filter((point) => point !== undefined)) drawing.lines!.push(routeDot(point, size * 0.35, colors[i]))
    }
    const status = this.failed ? 'failed' : capture ? 'ngspice samples · candidate-unqualified' : this.running ? 'running ngspice…' : 'deck ready'
    return routeTitle(drawing, `6 · Transient · ${status}`, this.failed ? [{ text: this.error ?? 'Transient failed', color: '#dc2626' }] : [])
  }
}
