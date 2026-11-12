import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { rootScope, snapshot, type Produced } from '../kernel'
import { connectedSourceIds } from './connectivity'
import { routeSectionSteps, routeContactFrame, type SectionGeometry } from './route-sections'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import { routeSectionDrawing, routeBoardDrawing, routeSliceDrawing, routeText } from './route-visual'

export interface RouteSectionsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  requiredSourcePortIds: string[]
  referenceSourcePortId: string
  artifactPrefix: string
}
export interface RoutedSections {
  circuitJson: CircuitJson
  scope: CopperScope
  geometry: SectionGeometry
  maskThicknessMm: number | null
}

/** Segment one real route per step, then admit selected endpoint contacts. */
export class RouteSectionsSolver extends BaseSolver {
  private steps?: Generator<SectionGeometry, SectionGeometry>
  private geometry?: SectionGeometry
  private output?: Produced<RoutedSections>
  private scope: CopperScope
  /** Capture source values and correct the owned AC rail scope. */
  constructor(private readonly input: RouteSectionsInput) {
    super()
    const ground = connectedSourceIds(input.circuitJson, input.referenceSourcePortId)
    const traces = input.circuitJson.filter(record => record.type === 'source_trace').filter(trace => [...trace.connected_source_port_ids, ...trace.connected_source_net_ids ?? []].some(id => ground.has(id))).map(trace => trace.source_trace_id)
    this.scope = { ...input.scope, nonReferenceRailTraceIds: [...input.scope.nonReferenceRailTraceIds, ...input.circuitJson.filter(record => record.type === 'pcb_trace').filter(trace => traces.includes(trace.source_trace_id!)).map(trace => trace.pcb_trace_id)] }
  }
  /** Each yield has performed one route's segmentation; the final pass slices actual references. */
  override _step(): void {
    this.steps ??= routeSectionSteps(this.input.circuitJson, this.scope)
    const result = this.steps.next()
    this.geometry = result.value
    this.stats = { routes: Math.min(this.iterations, this.scope.pcbTraceIds.length), wires: this.geometry.wires.length, slices: this.geometry.slices.length }
    if (!result.done) return
    const masks = this.input.circuitJson.filter(record => record.type === 'pcb_stackup')[0].layers.filter(layer => layer.layer_type === 'soldermask')
    if (new Set(masks.map(layer => layer.thickness)).size > 1) throw new Error('Asymmetric soldermask thickness requires separate outer-layer material profiles')
    for (const id of this.input.requiredSourcePortIds) {
      const port = this.input.circuitJson.find(record => record.type === 'pcb_port' && record.source_port_id === id)
      if (!port || port.type !== 'pcb_port' || !port.layers.some(layer => routeContactFrame(this.geometry!, this.scope, layer, [port.x, port.y]))) throw new Error(`selected endpoint ${id} has no physical wire or via contact`)
    }
    const value = snapshot({ circuitJson: this.input.circuitJson, scope: this.scope, geometry: this.geometry, maskThicknessMm: masks[0]?.thickness ?? null })
    const scope = rootScope('board').child(this.input.artifactPrefix)
    this.output = { value, artifacts: [scope.json('geometry.json', value.geometry), scope.json('scope.json', value.scope)] }
    this.solved = true
  }
  /** Completed immutable geometry only. */
  override getOutput(): Produced<RoutedSections> {
    if (!this.output) throw new Error('Route sections are incomplete')
    return this.output
  }
  /** Original problem, independent of work state. */
  override getConstructorParams(): [RouteSectionsInput] { return [this.input] }
  /** Physical copper, orange vias, magenta joins and the current amber slice. */
  override visualize(): GraphicsObject {
    const drawing = this.geometry
      ? routeSectionDrawing(this.input.circuitJson, this.geometry, this.scope, '1 · Sections: partition routed copper')
      : routeBoardDrawing(this.input.circuitJson, this.scope, '1 · Sections: partition routed copper')
    const slice = this.geometry?.slices.at(-1)
    if (slice) routeSliceDrawing(drawing, this.input.circuitJson, slice)
    if (this.failed) routeText(drawing, 2, 83, this.error ?? 'Rejected endpoint', '#dc2626')
    return drawing
  }
}
