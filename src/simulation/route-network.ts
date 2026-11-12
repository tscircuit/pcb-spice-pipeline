import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { connectedSourceIds, resolveRouteVias, routePosition, routeContactFrame, routeSectionDrawing, routeBoardPoint, routeText, routeDisplayItems, type RouteWire, type RouteXY } from '../board'
import { rootScope, snapshot, sha256, type Produced } from '../kernel'
import { namespaceSpice } from './netlist'
import { branchSaves } from './branch-saves'
import { routeSpatialPoints, type RouteSpatialPoint } from './route-spatial'
import { routedControl } from './routed-control'
import { routedRequest } from './route-transient'
import { routeLadderSteps, type RouteLadder } from './route-ladder'
import { closestRoutePoints } from '../extraction'
import { routeOblique } from './route-oblique'
import { routeTransitions } from './route-transitions'
import type { RoutedDeck, RouteNetworkInput } from './routed-types'

/** Physical node identity, coupled ladders, corrections and the single deck assembly. */
export class RouteNetworkSolver extends BaseSolver {
  private steps?: Generator<void, Produced<RoutedDeck>>
  private output?: Produced<RoutedDeck>
  private ladder?: RouteLadder
  private obliqueRecords: Record<string, unknown>[] = []
  /** Completed geometry, fields and bindings are immutable input snapshots. */
  constructor(private readonly input: RouteNetworkInput) { super() }
  /** Build one route run; the last step assembles the coupled energies and deck. */
  override _step(): void {
    this.steps ??= this.build()
    const result = this.steps.next()
    this.stats = { routeRuns: this.iterations, cells: this.ladder?.cells ?? 0, maximumCellDelaySeconds: this.ladder?.maximumDelaySeconds ?? 0 }
    if (result.done) {
      this.output = result.value
      this.solved = true
    }
  }
  /** Preserve the original compiler's exact node and SPICE ordering. */
  private *build(): Generator<void, Produced<RoutedDeck>> {
    const { geometry, extracted, bindings, options, materials } = this.input
    const { scope, models, mappings } = bindings
    const plan = structuredClone(bindings.plan)
    const electrical = { lines: bindings.electricalLines }
    const maskLayers = bindings.circuitJson.filter(record => record.type === 'pcb_stackup')[0].layers.filter(layer => layer.layer_type === 'soldermask')
    /** Every physical port was allocated by declarations before binding completed. */
    const node = (id: string): string => {
      const value = bindings.nodeMap[id]
      if (value === undefined) throw new Error(`Unknown routed electrical port ${id}`)
      return value
    }
    const aliases: string[] = []
    const known = new Map<string, string>()
    const spatialNodes = new Map<string, Map<string, RouteSpatialPoint>>()
    /** Coordinates join actual physical copper only; no straightening or whole-net ideal bypass. */
    const key = (layer: string, point: RouteXY): string => `${layer}:${point.map(n => n.toFixed(6)).join(',')}`
    for (const port of bindings.circuitJson.filter(record => record.type === 'pcb_port')) for (const layer of port.layers) {
      if (!routeContactFrame(geometry, scope, layer, [port.x, port.y])) continue
      const id = key(layer, [port.x, port.y])
      const portNode = node(port.source_port_id)
      const previous = known.get(id)
      if (previous && previous !== portNode) aliases.push(`RALIAS${aliases.length} ${previous} ${portNode} 1e-6`)
      else known.set(id, portNode)
    }
    /** Rail wires are explicit ideal AC electrodes; all other route junctions share physical coordinates. */
    const endpoint = (wire: RouteWire, point: RouteXY): string => {
      if (scope.nonReferenceRailTraceIds.includes(wire.trace)) return '0'
      const id = key(wire.layer, point)
      let node = known.get(id)
      if (!node) {
        node = `route${known.size}`
        known.set(id, node)
      }
      if (scope.selectedPcbTraceIds.includes(wire.trace)) {
        let points = spatialNodes.get(wire.trace)
        if (!points) spatialNodes.set(wire.trace, points = new Map())
        points.set(node, { node, net: wire.source, layer: wire.layer, x: point[0], y: point[1] })
      }
      return node
    }
    for (const wire of geometry.wires) for (const join of wire.joins ?? []) {
      const from = endpoint(wire, join.from)
      const to = endpoint(wire, join.to)
      if (from !== to) aliases.push(`RJOIN${aliases.length} ${from} ${to} 1e-6`)
    }
    const steps = routeLadderSteps(extracted, endpoint, options.riseSeconds, options.refinement, options.cellsPerRise, options.returnPath)
    let result = steps.next()
    while (!result.done) {
      this.ladder = result.value
      yield
      result = steps.next()
    }
    const ladder = result.value
    this.ladder = ladder
    const oblique = routeOblique(geometry, extracted, ladder, scope, materials, options.panels)
    const transitions = routeTransitions(bindings.circuitJson, scope, geometry, endpoint, bindings.groundSourcePortId)
    const title = options.returnPath?.model === 'series' ? 'Hybrid 3D R/L and routed 2D C' : options.returnPath ? 'Routed 2D with hybrid finite-return closure' : 'Routed quasi-TEM coupled 2D extraction'
    const lines = [`${title}; JLC standard stackup (assumed)`, `.options klu reltol=1e-4 abstol=${options.currentToleranceA ?? 1e-9} vntol=1e-6 method=gear maxord=2`, ...electrical.lines]
    const saved: string[] = []
    for (const [i, model] of models.entries()) {
      const namespaced = namespaceSpice(model.source, `I${i}`)
      const header = model.source.match(/^\.subckt\s+\S+\s+(.+)$/mi)!
      const nodes = header[1].trim().split(/\s+/).map(terminal => node(model.spicePinMapping[terminal]))
      saved.push(...branchSaves(namespaced.source, `XIBIS${i}`, namespaced.wrapper))
      lines.push(namespaced.source, `XIBIS${i} ${nodes.join(' ')} ${namespaced.wrapper}`)
    }
    for (const collection of [aliases, ladder.lines, oblique.lines, transitions.lines]) for (const line of collection) lines.push(line)
    const biasNodes = [...new Set([...ladder.wireNodes.values()].flatMap(records => records.map(record => record.node)).concat(models.flatMap(model => Object.values(model.spicePinMapping).map(port => node(port)))))].filter(node => node !== '0')
    for (const [i, node] of biasNodes.entries()) lines.push(`RBIAS${i} ${node} 0 1e9`)
    for (const probe of [...plan.probes].filter(probe => probe.referenceNode !== '0')) {
      for (const [suffix, signalNode, signalSourceId] of [['P', probe.signalNode, probe.signalSourceId], ['N', probe.referenceNode, probe.referenceSourceId]] as const) plan.probes.push({ ...probe, name: `${probe.name}_${suffix}`, simulationVoltageProbeId: `${probe.simulationVoltageProbeId}_${suffix}`, column: plan.probes.length + 1, signalNode, signalSourceId: signalSourceId!, referenceNode: '0', referenceSourceId: bindings.groundSourcePortId })
    }
    const probeNodes = plan.probes.flatMap(probe => [probe.signalNode, probe.referenceNode]).filter(node => node !== '0')
    const activeNodes = new Set([...ladder.wireNodes.values()].flatMap(records => records.map(record => record.node)).concat(probeNodes, aliases.flatMap(line => line.split(' ').slice(1, 3))))
    for (const transition of transitions.records) for (const point of transition.nodes ?? []) {
      activeNodes.add(point.node)
      const points = spatialNodes.get(transition.trace!)
      points?.set(point.node, { ...point, net: transition.trace! })
    }
    const spatialRoutes = bindings.circuitJson.filter(record => record.type === 'pcb_trace').filter(trace => spatialNodes.has(trace.pcb_trace_id)).map(trace => {
      const route = resolveRouteVias(bindings.circuitJson, trace)
      const connected = connectedSourceIds(bindings.circuitJson, bindings.circuitJson.filter(record => record.type === 'source_trace').find(source => source.source_trace_id === trace.source_trace_id)!.connected_source_port_ids[0])
      const net = bindings.circuitJson.find(record => record.type === 'source_net' && connected.has(record.source_net_id))
      const mapping = mappings.find(mapping => connected.has(mapping.from))
      const drivers = new Set(mappings.filter(other => other.port === mapping?.port).map(other => other.from))
      const label = net?.type === 'source_net' ? net.name : mapping ? `${mapping.port}${drivers.size > 1 ? `:${mapping.from}` : ''}` : trace.source_trace_id!
      /** Locate the exact allocated node along this physical polyline, including layer transitions. */
      const distance = (point: RouteSpatialPoint): number => {
        let offset = 0
        let nearest = Infinity
        let position = 0
        for (const [i, b] of route.entries()) {
          if (!i) continue
          const a = route[i - 1]
          const length = Math.hypot(b.x - a.x, b.y - a.y)
          const layer = b.route_type === 'via' ? b.to_layer : b.layer
          const fraction = length ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length ** 2)) : 0
          const gap = Math.hypot(point.x - a.x - fraction * (b.x - a.x), point.y - a.y - fraction * (b.y - a.y)) + (point.layer === layer ? 0 : 1e6)
          if (gap < nearest) {
            nearest = gap
            position = offset + fraction * length + i * 1e-9
          }
          offset += length
        }
        return position
      }
      return [...spatialNodes.get(trace.pcb_trace_id)!.values()].filter(point => activeNodes.has(point.node)).map(point => ({ ...point, net: label })).sort((a, b) => distance(a) - distance(b))
    })
    const spatialPoints = routeSpatialPoints(spatialRoutes, probeNodes)
    // Save probes first to preserve their ordering, plus bounded physical nodes and behavioural dependencies.
    const save = [...new Set([...probeNodes, ...spatialPoints.map(point => point.node)])].map(node => `v(${node})`).concat(saved).join(' ')
    lines.push(`* Routed probe nodes: ${[...new Set(probeNodes)].join(' ')}`, `* Routed probe pairs: ${plan.probes.map(probe => `${probe.signalNode},${probe.referenceNode}`).join(' ')}`)
    lines.push(...routedControl(save, options.stepSeconds, options.durationSeconds))
    const ground = connectedSourceIds(bindings.circuitJson, bindings.groundSourcePortId)
    const powerReferences = geometry.slices.flatMap(slice => slice.references.filter(plane => !ground.has(plane.net)).map(plane => ({ plane, traces: slice.wires.map(wire => wire.trace), start: slice.start, end: slice.end })))
    const mapped = new Set(models.flatMap(model => Object.values(model.spicePinMapping)))
    const external = bindings.circuitJson.filter(record => record.type === 'pcb_port').filter(port => !mapped.has(port.source_port_id) && port.layers.some(layer => routeContactFrame(geometry, scope, layer, [port.x, port.y])))
    const modelOptions = options
    const warnings = [...extracted.warnings, ...transitions.warnings, ...models.flatMap(model => model.warnings),
      ...(options.returnPath ? [options.returnPath.definition, 'Hybrid cell layout uses the ideal 2D delay bound; the additional/replaced magnetic network requires independent numerical refinement and remains unqualified.'] : []),
      `JLC standard stackup (assumed): JLC08121H-3313; mask thickness ${materials.maskMm} mm (${options.materials ? 'explicit material option' : maskLayers.length ? 'preset' : 'assumed; absent from preset'}). Mask er=${materials.maskEr}, tan(delta)=${materials.maskLoss} and laminate tan(delta)=${materials.substrateLoss}; explicit assumptions, not measured material data.`,
      'Numerical DC anchors: 1 Gohm per coarse route node; removes open-neighbour common-mode singularities without substituting a vendor load.',
      'Coplanar pours are not discretized into finite strip conductors; actual pours supply vertical references only. Their lateral shielding/coupling remains unqualified.',
      'Absent copper-layer volume is filled with nearest laminate; copper roughness, etch trapezoids and bend excess capacitance omitted.',
      'Oblique corrections apply selected-net to scoped-neighbour encounters within the same/adjacent layers; neighbour-to-neighbour oblique coupling is omitted. Added pair C uses existing isolated self C, a weak-coupling approximation. Placement is at the nearest ladder node; spacing is rounded outward to 1 um.',
      'Oblique surrogate blocked by an intervening local infinite reference plane is recorded as shielded, with plane-edge/aperture fringing omitted.',
      'Power rail wires are ideal AC electrodes: their longitudinal impedance and power-plane impedance are omitted.',
      `${external.length} external neighbour port bodies have open/ideal-logical terminations without additional vendor die models; actual endpoint IDs are recorded. This is a candidate channel experiment, not a complete board/PDN simulation.`]
    const evidence = { endpoint_nodes: Object.fromEntries(mappings.flatMap(mapping => [[mapping.from, node(mapping.from)], [mapping.to, node(mapping.to)]])), probes: plan.probes, label: 'JLC standard stackup (assumed)', materials, mask_thickness_source: options.materials ? 'explicit' : maskLayers.length ? 'preset' : 'assumed', options: modelOptions, scope, warnings, cells: ladder.cells, maximum_cell_delay_s: ladder.maximumDelaySeconds,
        return_path: options.returnPath, coupling: extracted.coupling, unique_cross_sections: extracted.sections.length + oblique.solves, oblique_cross_sections: oblique.solves, oblique_encounters: oblique.records, sections: extracted.slices.length, geometry_wires: geometry.wires.length, wires: geometry.wires, via_contacts: geometry.viaContacts,
        power_references: powerReferences, copper_overlap_patches: geometry.wires.filter(wire => wire.joins?.length), transitions: transitions.records, external_open_ports: external.map(port => port.source_port_id),
        assembly: models.map(model => ({ name: model.name, metadata: model.metadata, warnings: model.warnings, sourceEvidence: model.sourceEvidence })),
        routes: mappings.map(mapping => ({ ...mapping, length_mm: geometry.wires.filter(wire => wire.source === mapping.sourceTraceId).reduce((sum, wire) => sum + wire.end - wire.start, 0) })),
        cross_sections: extracted.sections.map(({ key, line }) => ({ geometry: JSON.parse(key), C: line.C, L: line.L, dcResistance: line.dcResistance, skinResistance: line.skinResistance, dielectricLoss: line.dielectricLoss, diagnostics: line.diagnostics })),
        slices: extracted.slices.map(slice => ({ start: slice.start, end: slice.end, point: routePosition(slice.wires[0], (slice.start + slice.end) / 2), wires: slice.wires.map(wire => wire.id), references: slice.references, key: slice.key })) }
    evidence.warnings.unshift(...this.input.warnings)
    this.obliqueRecords = oblique.records
    const deck = lines.join('\n') + '\n'
    const value = snapshot({ blockId: this.input.blockId, name: this.input.name, deck, requestSha256: sha256(JSON.stringify(routedRequest({ deck }))), probes: plan.probes, spatialPoints, durationSeconds: options.durationSeconds, stepSeconds: options.stepSeconds, evidence })
    const artifactScope = rootScope('simulation').child(this.input.artifactPrefix)
    return { value, artifacts: [artifactScope.text('simulation.cir', deck), artifactScope.json('evidence.json', evidence)] }
  }
  /** No partial deck can be executed. */
  override getOutput(): Produced<RoutedDeck> {
    if (!this.output) throw new Error('Route network is incomplete')
    return this.output
  }
  /** Input snapshots only. */
  override getConstructorParams(): [RouteNetworkInput] { return [this.input] }
  /** Cell ticks and encounters stay on real routes; only display samples are capped. */
  override visualize(): GraphicsObject {
    const { geometry, bindings } = this.input
    const circuit = bindings.circuitJson
    const drawing = routeSectionDrawing(circuit, geometry, bindings.scope, '5 · Network: build a coupled ladder')
    drawing.texts = drawing.texts!.filter((text) => text.y !== 87)
    routeText(
      drawing,
      2,
      87,
      `${this.ladder?.cells ?? 0} cells · max cell delay ${((this.ladder?.maximumDelaySeconds ?? 0) * 1e12).toFixed(2)} ps`,
      '#a16207',
    )
    const nodes = [...(this.ladder?.wireNodes ?? [])].flatMap(([id, samples]) => samples.map((sample) => ({ id, position: sample.position })))
    for (const sample of routeDisplayItems(nodes, 800)) {
      const wire = geometry.wires.find((wire) => wire.id === sample.id)!
      const point = routeBoardPoint(circuit, routePosition(wire, sample.position))
      drawing.lines?.push({
        points: [-1, 1].map((sign) => ({ x: point.x - sign * wire.u[1] * 0.8, y: point.y + sign * wire.u[0] * 0.8 })),
        strokeColor: '#f59e0b',
        strokeWidth: 0.25,
      })
    }
    for (const record of routeDisplayItems(this.obliqueRecords, 120)) {
      if (!Array.isArray(record.wires)) continue
      const wires = geometry.wires.filter((wire) => (record.wires as unknown[]).includes(wire.id))
      if (wires.length !== 2) continue
      const near = closestRoutePoints(wires[0].a, wires[0].b, wires[1].a, wires[1].b)
      const points = [near.first, near.second].map((point) => routeBoardPoint(circuit, point))
      drawing.lines?.push({ points, strokeColor: '#9333ea', strokeWidth: 0.5, label: String(record.policy) })
      drawing.circles?.push({ center: points[0], radius: 0.55, stroke: '#9333ea' })
    }
    const transitions = this.output?.value.evidence.transitions
    if (Array.isArray(transitions))
      for (const record of routeDisplayItems(
        transitions.filter((record) => record.kind === 'via'),
        160,
      )) {
        const via = circuit.find((item) => item.type === 'pcb_via' && item.pcb_via_id === record.id)
        if (via?.type === 'pcb_via') drawing.circles?.push({ center: routeBoardPoint(circuit, [via.x, via.y]), radius: 1, stroke: '#f97316' })
      }
    routeText(drawing, 2, 81, 'Amber: cells · Purple: oblique encounters', '#475569')
    routeText(drawing, 2, 76, 'Orange rings: vias', '#475569')
    routeText(
      drawing,
      2,
      71,
      `${Math.min(nodes.length, 800)}/${nodes.length} node ticks shown · ${this.output ? this.obliqueRecords.length : 'pending'} oblique encounters · native not run`,
      '#64748b',
    )
    if (this.failed)
      for (const [i, reason] of (`Network rejected: ${this.error ?? 'Compilation incomplete'}`.match(/.{1,85}/g) ?? []).slice(0, 3).entries())
        routeText(drawing, 2, 70 - i * 3, reason, '#dc2626')
    return drawing
  }
}
