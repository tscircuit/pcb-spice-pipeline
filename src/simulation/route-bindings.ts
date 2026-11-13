import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { admitBuffers, compileBuffers, ibisAssembly, type AdmittedBuffers, type AssemblyEntry } from '../buffers'
import { rootScope, snapshot, type Artifact, type Produced } from '../kernel'
import { routeBoardDrawing, routeDrawingUnit, routeFailure, routeFocus, routeInside, routeMarks, routePortPoint, routeSourceColor, routeSources, routeTones } from '../board'
import { generalDeclarations, modelRunDefinition } from './declarations'
import { electricalSources } from './netlist'
import type { Declarations, SimulationPlan } from './types'
import type { RouteBindingsInput, RoutedBindings, RouteBuffer } from './routed-types'

/** Bind one vendor buffer per step; electrical names retain source-record order. */
export class RouteBindingsSolver extends BaseSolver {
  private declarations?: Declarations
  private admitted?: AdmittedBuffers
  private plan?: SimulationPlan
  private electricalLines: string[] = []
  private readonly models: RouteBuffer[] = []
  private readonly assembly: AssemblyEntry[] = []
  private readonly artifacts: Artifact[] = []
  private output?: Produced<RoutedBindings>
  /** Inputs contain domain intent, never another stage's internals. */
  constructor(private readonly input: RouteBindingsInput) { super() }
  /** Cut physical copper out of ideal connectivity, then compile one original IBIS model. */
  override _step(): void {
    const scope = rootScope('buffers').child(this.input.artifactPrefix)
    if (!this.declarations) {
      const mappings = structuredClone(this.input.mappings)
      if (!mappings.length) throw new Error('Routed compilation requires physical signal mappings')
      mappings[0].sourceTraceIds = this.input.circuitJson.filter(record => record.type === 'pcb_trace').filter(trace => this.input.scope.pcbTraceIds.includes(trace.pcb_trace_id) && !this.input.scope.nonReferenceRailTraceIds.includes(trace.pcb_trace_id)).map(trace => trace.source_trace_id!)
      this.declarations = generalDeclarations(this.input.circuitJson, { mappings }, this.input.modeling)
      this.plan = this.declarations.plans[0]
      this.plan.durationSeconds = this.input.options.durationSeconds
      this.plan.maxStepSeconds = this.input.options.stepSeconds
      this.electricalLines = electricalSources(this.input.circuitJson, this.input.modeling, this.declarations.nodes).lines
      const admitted = admitBuffers(this.declarations.models, this.input.ibisSources, {}, scope)
      this.admitted = admitted.value
      this.artifacts.push(...admitted.artifacts)
    }
    const model = this.declarations.models[this.models.length]
    if (model) {
      const [compiled] = compileBuffers(this.admitted!, [{ ...this.plan!, models: [model] }], modelRunDefinition)[0]
      this.models.push({ name: compiled.name, source: compiled.source, spicePinMapping: compiled.spicePinMapping, metadata: compiled.metadata, warnings: compiled.warnings, sourceEvidence: compiled.sourceEvidence })
      this.assembly.push(...ibisAssembly([compiled], scope).value)
    }
    this.stats = { models: this.models.length, probes: this.plan!.probes.length, warnings: this.models.reduce((n, model) => n + model.warnings.length, 0) }
    if (this.models.length !== this.declarations.models.length) return
    const value = snapshot({ circuitJson: this.input.circuitJson, scope: this.input.scope, mappings: this.input.mappings, plan: this.plan!, nodeMap: this.declarations.nodes.mapping, groundSourcePortId: this.declarations.nodes.groundSourcePortId, electricalLines: this.electricalLines, models: this.models })
    this.artifacts.push(scope.json('native-ibis-assembly.json', this.assembly), rootScope('simulation').child(this.input.artifactPrefix).json('electrical-node-map.json', { nodes: value.nodeMap, channelReferenceSourcePortId: value.groundSourcePortId }))
    this.output = { value, artifacts: this.artifacts }
    this.solved = true
  }
  /** Complete immutable bindings only. */
  override getOutput(): Produced<RoutedBindings> {
    if (!this.output) throw new Error('Route bindings are incomplete')
    return this.output
  }
  /** Original input without converter objects. */
  override getConstructorParams(): [RouteBindingsInput] { return [this.input] }
  /** Bound pins at their pads in their net's colour: drivers as dots, receivers as rings, rail pins near the copper as small grey dots; unbound lane ends turn red. */
  override visualize(): GraphicsObject {
    const circuit = this.input.circuitJson
    const drawing = routeBoardDrawing(circuit, this.input.scope, 0.6)
    const sources = routeSources(circuit, this.input.scope)
    const focus = routeFocus(circuit, this.input.scope)
    const unit = routeDrawingUnit(drawing, circuit)
    const marks = this.models.flatMap((model) =>
      [...new Set(Object.values(model.spicePinMapping))].flatMap((id) => {
        const point = routePortPoint(circuit, id)
        const lane = this.input.mappings.find((mapping) => mapping.from === id || mapping.to === id)
        if (!point || !lane || !model.metadata.pins.some((pin) => pin.port === id)) {
          if (point && (!focus || routeInside(point, focus))) drawing.circles!.push({ center: point, radius: unit * 0.3, fill: routeTones.quiet, stroke: routeTones.quiet })
          return []
        }
        return [{ point, color: routeSourceColor(sources, lane.sourceTraceId), driver: Boolean(this.plan?.states.some((state) => state.source_port_id === id && state.is_output)) }]
      }),
    )
    routeMarks(drawing, marks, unit)
    if (this.failed) {
      routeMarks(drawing, this.input.mappings.flatMap((mapping) => [mapping.from, mapping.to]).flatMap((id) => {
        const point = routePortPoint(circuit, id)
        return point ? [{ point, color: routeTones.failure, driver: false }] : []
      }), unit * 1.5)
      routeFailure(drawing, circuit, this.error ?? 'IBIS binding unavailable')
    }
    return drawing
  }
}
