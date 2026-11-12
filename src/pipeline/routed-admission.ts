import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { validateCircuitRecords, routeBoardDrawing, routeBoardPoint, routeText, routeDisplayItems, type CircuitJson, type LaneMapping } from '../board'
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
  /** Selected routes and endpoints blue, neighbours grey, references green, rejection red. */
  override visualize(): GraphicsObject {
    const plan = this.plans.at(-1)
    const drawing = routeBoardDrawing(this.input.circuitJson, plan?.sections.scope, '1 · Admission: choose signal copper')
    routeText(
      drawing,
      2,
      87,
      `${plan?.sections.requiredSourcePortIds.length ?? 0} endpoints · scope radius ${this.input.scopeDistanceMm ?? 32} mm · ${this.plans.length} admitted blocks`,
    )
    const labels = [0, 0]
    for (const [i, id] of routeDisplayItems(plan?.sections.requiredSourcePortIds ?? [], 48).entries()) {
      const port = this.input.circuitJson.find((record) => record.type === 'pcb_port' && record.source_port_id === id)
      if (port?.type !== 'pcb_port') continue
      const point = routeBoardPoint(this.input.circuitJson, [port.x, port.y])
      drawing.points?.push({ ...point, color: '#2563eb', label: id })
      drawing.circles?.push({ center: point, radius: 0.65, stroke: '#2563eb' })
      if (i < 8) {
        const source = this.input.circuitJson.find((record) => record.type === 'source_port' && record.source_port_id === id)
        const component =
          source?.type === 'source_port' &&
          this.input.circuitJson.find((record) => record.type === 'source_component' && record.source_component_id === source.source_component_id)
        const side = point.x < 50 ? 0 : 1
        const x = side ? 57 : 18
        const y = 39 - labels[side]++ * 3
        drawing.lines?.push({ points: [point, { x, y }], strokeColor: '#2563eb', strokeWidth: 0.1 })
        routeText(
          drawing,
          x,
          y - 1.5,
          source?.type === 'source_port' ? `${component && component.type === 'source_component' ? component.name : ''}.${source.name}` : id,
          '#1d4ed8',
        )
      }
    }
    if (this.failed) {
      for (const [i, reason] of (`Rejected: ${this.error ?? 'Invalid signal scope'}`.match(/.{1,85}/g) ?? []).slice(0, 3).entries())
        routeText(drawing, 2, 83 - i * 3, reason, '#dc2626')
      drawing.lines?.push({
        points: [
          { x: 16, y: 16 },
          { x: 84, y: 84 },
        ],
        strokeColor: '#dc2626',
        strokeWidth: 0.5,
      })
    }
    return drawing
  }
}
