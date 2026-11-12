import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { admitBuffers, compileBuffers, ibisAssembly, type AdmittedBuffers, type AssemblyEntry } from '../buffers'
import { rootScope, snapshot, type Artifact, type Produced } from '../kernel'
import { routeBoardDrawing, routeBoardPoint, routeText, routeDisplayItems } from '../board'
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
  /** Pins keep their physical position; a small labelled key explains their vendor binding. */
  override visualize(): GraphicsObject {
    const circuit = this.input.circuitJson
    const drawing = routeBoardDrawing(circuit, this.input.scope, '4 · Bindings: attach IBIS buffers')
    routeText(
      drawing,
      2,
      87,
      `${this.models.length}/${this.declarations?.models.length ?? '?'} models bound · Blue: driver · Cyan: receiver · Green: rail`,
      '#475569',
    )
    const labels = new Map<string, { point: { x: number; y: number }; name: string; color: string; pins: number }>()
    for (const model of routeDisplayItems(this.models, 48)) {
      const signals = model.metadata.pins
      for (const id of new Set(Object.values(model.spicePinMapping))) {
        const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === id)
        if (!port || port.type !== 'pcb_port') continue
        const point = routeBoardPoint(circuit, [port.x, port.y])
        const signal = signals.find((pin) => pin.port === id)
        const driver = this.plan?.states.some((state) => state.source_port_id === id && state.is_output)
        const color = !signal ? '#16a34a' : driver ? '#2563eb' : '#06b6d4'
        drawing.circles?.push({ center: point, radius: signal ? 0.85 : 0.5, fill: color, stroke: color })
        if (!signal) continue
        const source = circuit.find((record) => record.type === 'source_port' && record.source_port_id === id)
        const component =
          source?.type === 'source_port' &&
          circuit.find((record) => record.type === 'source_component' && record.source_component_id === source.source_component_id)
        const name = `${component && component.type === 'source_component' ? component.name : model.name} ${driver ? 'driver' : 'receiver'} → ${signal.model}`
        const previous = labels.get(name)
        labels.set(name, { point: previous?.point ?? point, name, color, pins: (previous?.pins ?? 0) + 1 })
      }
    }
    for (const [i, label] of [...labels.values()].slice(0, 6).entries()) {
      const y = 38 - i * 5
      drawing.lines?.push({ points: [label.point, { x: 20 + i * 8, y: y + 1 }], strokeColor: label.color, strokeWidth: 0.1 })
      routeText(drawing, 2, y, `${label.name}${label.pins > 1 ? ` (${label.pins} pins)` : ''}`, label.color)
    }
    if (labels.size > 6) routeText(drawing, 2, 12, `First 6 bindings labelled; all ${this.models.length} models retained`, '#64748b')
    if (this.failed) {
      for (const [i, reason] of (`Missing / rejected model: ${this.error ?? 'IBIS binding unavailable'}`.match(/.{1,85}/g) ?? []).slice(0, 3).entries())
        routeText(drawing, 2, 82 - i * 3, reason, '#dc2626')
      for (const port of routeDisplayItems(
        circuit
          .filter((record) => record.type === 'pcb_port')
          .filter((record) => this.input.mappings.some((mapping) => mapping.from === record.source_port_id || mapping.to === record.source_port_id)),
        48,
      ))
        drawing.circles?.push({ center: routeBoardPoint(circuit, [port.x, port.y]), radius: 1, stroke: '#dc2626' })
    }
    return drawing
  }
}
