import { BaseSolver } from '@tscircuit/solver-utils'
import { admitBuffers, compileBuffers, ibisAssembly, type AdmittedBuffers, type AssemblyEntry } from '../buffers'
import { rootScope, snapshot, type Artifact, type Produced } from '../kernel'
import { routeBoardDrawing, routeDisplayItems, routeDot, routePortLabel, routePortPoint, routeRing, routeText, routeTextSize, routeTitle, type StageDrawing } from '../board'
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
  /** Drivers as filled blue dots, receivers as cyan rings, rail pins as small green dots; each bound part named once. */
  override visualize(): StageDrawing {
    const circuit = this.input.circuitJson
    const drawing = routeBoardDrawing(circuit, this.input.scope)
    const size = routeTextSize(drawing.focus!)
    const named = new Set<string>()
    for (const model of routeDisplayItems(this.models, 48)) {
      for (const id of new Set(Object.values(model.spicePinMapping))) {
        const point = routePortPoint(circuit, id)
        if (!point) continue
        const signal = model.metadata.pins.find((pin) => pin.port === id)
        const driver = this.plan?.states.some((state) => state.source_port_id === id && state.is_output)
        if (!signal) {
          drawing.lines!.push(routeDot(point, size.body * 0.15, '#16a34a'))
          continue
        }
        drawing.lines!.push(driver ? routeDot(point, size.body * 0.4, '#1d4ed8') : routeRing(point, size.body * 0.4, '#0891b2', size.body * 0.15))
        const name = `${routePortLabel(circuit, id).split('.')[0]} ${signal.model}`
        if (named.has(name) || named.size >= 6) continue
        named.add(name)
        routeText(drawing, point.x + size.body * 0.7, point.y - size.body * 0.9, name, driver ? '#1d4ed8' : '#0e7490', size.body)
      }
    }
    if (this.failed)
      for (const mapping of routeDisplayItems(this.input.mappings, 48))
        for (const id of [mapping.from, mapping.to]) {
          const point = routePortPoint(circuit, id)
          if (point) drawing.lines!.push(routeRing(point, size.body * 0.6, '#dc2626', size.body * 0.15))
        }
    const reasons = this.failed ? (`Missing / rejected model: ${this.error ?? 'IBIS binding unavailable'}`.match(/.{1,85}/g) ?? []).slice(0, 3) : []
    return routeTitle(drawing, '4 · Bindings', reasons.map((text) => ({ text, color: '#dc2626' })))
  }
}
