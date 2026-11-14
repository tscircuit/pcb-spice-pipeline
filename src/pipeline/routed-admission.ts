import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { validateCircuitRecords, routeBoardBox, routeBoardDrawing, routeFailure, routeLengths, routeMarks, routePortPoint, routeStrip, routeView, type CircuitJson, type LaneMapping } from '../board'
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
      const block = prepareBlockById(this.input.circuitJson, this.input.ibisSources, id, this.input.scopeDistanceMm ?? 32)
      const mappings: LaneMapping[] = block.signals.flatMap(signal => signal.receivers.flatMap(receiver => endpointPorts(receiver).map((to, i) => {
        const from = endpointPorts(signal.driver)[i]
        const lane = block.settings.lanes.find(lane => lane.from.sourcePortId === from || lane.to.sourcePortId === from)!
        return { port: signal.name, from, to, sourceTraceId: lane.sourceTraceId! }
      })))
      const experiment = block.circuit.find(record => record.type === 'simulation_experiment')!
      if (experiment.type !== 'simulation_experiment') throw new Error('Missing admitted experiment')
      const options: RoutedCompileOptions = { riseSeconds: Math.min(...block.signals.flatMap(signal => endpointPorts(signal.driver)).map(id => edgeSeconds(block.pins.get(id)!))), refinement: 1, stepSeconds: experiment.time_per_step! / 1000, durationSeconds: block.duration, materials: this.input.materials }
      const artifactPrefix = `blocks/${id}`
      this.plans.push(snapshot({ id, name: block.block.name ?? id, warnings: block.warnings,
        sections: { circuitJson: block.circuit, scope: block.settings.copperScope, requiredSourcePortIds: block.settings.lanes.flatMap(lane => [lane.from.sourcePortId!, lane.to.sourcePortId!]), referenceSourcePortId: block.settings.channelReference!.sourcePortId!, artifactPrefix },
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
  /** Selected copper in net colours with drivers as dots and receivers as rings, and each net's routed length unrolled in the pane; a rejection writes one red reason. */
  override visualize(): GraphicsObject {
    const plan = this.plans.at(-1)
    const circuit = this.input.circuitJson
    const drawing = routeBoardDrawing(circuit, plan?.sections.scope)
    const view = plan && routeView(circuit, plan.sections.scope)
    if (view) routeStrip(drawing, view.pane, routeLengths(circuit, view))
    if (view)
      routeMarks(drawing, plan.bindings.mappings.flatMap(mapping => ([[mapping.from, true], [mapping.to, false]] as const).flatMap(([id, driver]) => {
        const point = routePortPoint(circuit, id)
        const net = view.ports.get(id)
        return point ? [{ point, color: net?.color ?? '#ffffff', driver, label: net?.label }] : []
      })), view.unit)
    if (this.failed) routeFailure(drawing, view?.pane ?? routeBoardBox(circuit), this.error ?? 'Invalid signal scope')
    return drawing
  }
}
