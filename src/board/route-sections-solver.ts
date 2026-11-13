import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { rootScope, snapshot, type Produced } from '../kernel'
import { connectedSourceIds } from './connectivity'
import { routeSectionSteps, routeContactFrame, type SectionGeometry } from './route-sections'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'
import { routeCanvas, routeFailure, routeHue, routeLengths, routeNets, routeStrip, routeStroke, routeTones, routeUnrolled, routeVia, routeView, type RouteStripRow } from './route-visual'

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
  /** Sections alternate two tones of their net's hue, the route cut this step wears a white casing, and copper not yet cut stays neutral grey. */
  override visualize(): GraphicsObject {
    const circuit = this.input.circuitJson
    const view = routeView(circuit, this.scope)
    const drawing = routeCanvas(view)
    const wires = (this.geometry?.wires ?? []).filter(wire => view.traces.has(wire.trace))
    const done = new Set(wires.map(wire => wire.trace))
    routeNets(drawing, circuit, view, new Set([...view.traces].filter(id => !done.has(id))), () => routeTones.copper)
    const active = this.solved ? undefined : wires.at(-1)?.trace
    const tone = new Map<string, number>()
    for (const wire of wires) {
      const net = view.sources.get(wire.source)
      const index = (tone.get(wire.trace) ?? -1) + 1
      tone.set(wire.trace, index)
      const points = [wire.a, wire.b].map(([x, y]) => ({ x, y }))
      if (wire.trace === active) drawing.lines!.push({ points, strokeColor: routeTones.via, strokeWidth: wire.width * 2.2 })
      drawing.lines!.push(...routeStroke(points, net ? routeHue(net.hue, Math.min(86, net.lightness + (index % 2 ? 16 : -6))) : routeTones.copper, wire.width, wire.layer, net?.label))
    }
    // The pane unrolls each net: its sections in the same two tones, uncut copper grey.
    const unrolled = routeUnrolled(view, wires)
    const rows = new Map<string, RouteStripRow>(routeLengths(circuit, view).map(row => [row.net.label, { ...row, parts: [] }]))
    tone.clear()
    for (const wire of wires) {
      const at = unrolled.along(wire.id, wire.start)
      const row = at && rows.get(at.net.label)
      if (!row || !at) continue
      const index = (tone.get(at.net.label) ?? -1) + 1
      tone.set(at.net.label, index)
      row.parts!.push({ from: at.distance, to: at.distance + wire.end - wire.start, color: routeHue(at.net.hue, Math.min(86, at.net.lightness + (index % 2 ? 16 : -6))), casing: wire.trace === active })
    }
    for (const row of rows.values()) {
      const cut = (row.parts!.at(-1)?.to ?? 0)
      row.length = Math.max(row.length, cut)
      if (cut < row.length) row.parts!.push({ from: cut, to: row.length, color: routeTones.copper })
    }
    routeStrip(drawing, view.pane, [...rows.values()])
    const width = wires.length ? wires.reduce((sum, wire) => sum + wire.width, 0) / wires.length : view.unit
    for (const contact of this.geometry?.viaContacts ?? []) if (view.traces.has(contact.trace)) routeVia(drawing, { x: contact.point[0], y: contact.point[1] }, width * 1.4)
    if (this.failed) routeFailure(drawing, view.pane, this.error ?? 'Rejected endpoint')
    return drawing
  }
}
