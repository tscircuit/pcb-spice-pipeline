import { BaseSolver } from '@tscircuit/solver-utils'
import { validateCircuitRecords, routeBoardDrawing, routeDisplayItems, routeFocus, boardBounds, routePortLabel, routePortPoint, routeRing, routeText, routeTextSize, routeTitle, overlayLine, type CircuitJson, type LaneMapping, type StageDrawing } from '../board'
import { edgeSeconds, type IbisSources } from '../buffers'
import { rootScope, snapshot, sha256, type Produced } from '../kernel'
import type { RouteSectionsInput } from '../board'
import type { RoutedCompileOptions, RouteBindingsInput } from '../simulation'
import { endpointPorts, prepareBlockById, signalBlocks } from './signals'

export interface RoutedProblem {
  circuitJson: CircuitJson
  ibisSources: IbisSources
  scopeDistanceMm?: number
  materials?: RoutedCompileOptions['materials']
}
export interface RoutedBlockPlan {
  id: string
  name: string
  sections: RouteSectionsInput
  bindings: Omit<RouteBindingsInput, 'scope'>
  warnings: string[]
}
/** Root admission performs exactly one SI block's lowering per step. */
export class RoutedAdmissionSolver extends BaseSolver {
  private ids?: string[]
  private readonly plans: RoutedBlockPlan[] = []
  private output?: Produced<RoutedBlockPlan[]>
  /** No native capability is available during admission. */
  constructor(private readonly input: RoutedProblem) { super() }
  /** Shared prepareBlockById retains the existing intent, warnings and model policy. */
  override _step(): void {
    if (!this.ids) {
      validateCircuitRecords(this.input.circuitJson)
      this.ids = signalBlocks(this.input.circuitJson).map(block => block.simulation_signal_integrity_id)
      const distance = this.input.scopeDistanceMm ?? 32
      if (!Number.isFinite(distance) || distance <= 0 || distance > 32) throw new Error('Copper scope distance must be in (0,32] mm')
    }
    const id = this.ids[this.plans.length]
    if (id) {
      const block = prepareBlockById(this.input.circuitJson, this.input.ibisSources, id, '2d', this.input.scopeDistanceMm ?? 32)
      const mappings: LaneMapping[] = block.signals.flatMap(signal => signal.receivers.flatMap(receiver => endpointPorts(receiver).map((to, i) => {
        const from = endpointPorts(signal.driver)[i]
        const lane = block.settings.lanes.find(lane => lane.from.sourcePortId === from || lane.to.sourcePortId === from)!
        return { port: signal.name, from, to, sourceTraceId: lane.sourceTraceId!, pcbTraceId: '', pcbPorts: [], stages: [], originalRoute: [] }
      })))
      const experiment = block.circuit.find(record => record.type === 'simulation_experiment')!
      if (experiment.type !== 'simulation_experiment') throw new Error('Missing admitted experiment')
      const options: RoutedCompileOptions = { riseSeconds: Math.min(...block.signals.flatMap(signal => endpointPorts(signal.driver)).map(id => edgeSeconds(block.pins.get(id)!))), refinement: 1, stepSeconds: experiment.time_per_step! / 1000, durationSeconds: block.duration, materials: this.input.materials }
      const artifactPrefix = `blocks/${id}`
      this.plans.push(snapshot({ id, name: block.block.name ?? id, warnings: block.warnings,
        sections: { circuitJson: block.circuit, scope: block.settings.copperScope!, requiredSourcePortIds: block.settings.lanes.flatMap(lane => [lane.from.sourcePortId!, lane.to.sourcePortId!]), referenceSourcePortId: block.settings.channelReference!.sourcePortId!, artifactPrefix },
        bindings: { circuitJson: block.circuit, mappings, modeling: block.settings, ibisSources: this.input.ibisSources, options, artifactPrefix } }))
    }
    this.stats = { blocks: this.plans.length, selectedConductors: this.plans.reduce((n, plan) => n + plan.sections.scope.selectedPcbTraceIds.length, 0) }
    if (this.plans.length !== this.ids.length) return
    const value = snapshot(this.plans)
    this.output = { value, artifacts: [rootScope('pipeline').json('admission.json', { blocks: value.map(plan => ({ id: plan.id, name: plan.name, warnings: plan.warnings })), models: Object.fromEntries(Object.entries(this.input.ibisSources).map(([name, bytes]) => [name, sha256(bytes)])) })] }
    this.solved = true
  }
  /** No partially admitted block list escapes. */
  override getOutput(): Produced<RoutedBlockPlan[]> {
    if (!this.output) throw new Error('Routed admission is incomplete')
    return this.output
  }
  /** Original input only. */
  override getConstructorParams(): [RoutedProblem] { return [this.input] }
  /** Selected copper bright at its real width, endpoints ringed and named; a rejection crosses the board out. */
  override visualize(): StageDrawing {
    const circuit = this.input.circuitJson
    const plan = this.plans.at(-1)
    const drawing = routeBoardDrawing(circuit, plan?.sections.scope)
    const ids = routeDisplayItems(plan?.sections.requiredSourcePortIds ?? [], 48)
    const points = ids.flatMap((id) => [routePortPoint(circuit, id)].flatMap((point) => (point ? [{ id, point }] : [])))
    if (points.length && !plan?.sections.scope.selectedPcbTraceIds.length) drawing.focus = routeFocus(points.map(({ point }) => point), boardBounds(circuit))
    const size = routeTextSize(drawing.focus!)
    for (const [i, { id, point }] of points.entries()) {
      drawing.lines!.push(routeRing(point, size.body * 0.4, '#1d4ed8', size.body * 0.12))
      if (i < 8) routeText(drawing, point.x + size.body * 0.7, point.y + size.body * 1.1, routePortLabel(circuit, id), '#1d4ed8', size.body)
    }
    if (this.failed) {
      const { minX, maxX, minY, maxY } = drawing.focus!
      for (const line of [[{ x: minX, y: minY }, { x: maxX, y: maxY }], [{ x: minX, y: maxY }, { x: maxX, y: minY }]])
        drawing.lines!.push(overlayLine(line, '#dc262680', size.body * 0.3))
    }
    const reasons = this.failed ? (`Rejected: ${this.error ?? 'Invalid signal scope'}`.match(/.{1,85}/g) ?? []).slice(0, 3) : []
    const empty = this.solved && !this.plans.length ? [{ text: 'No signal-integrity blocks admitted', color: '#64748b' }] : []
    return routeTitle(drawing, '1 · Admission', [...reasons.map((text) => ({ text, color: '#dc2626' })), ...empty])
  }
}
