import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { connectedSourceIds, routePosition, routeContactFrame, routeBoardDrawing, routeDisplayItems, routeFailure, routeLengths, routeStrip, routeUnrolled, routeVia, routeTones, routeView, type RouteStripRow, type RouteWire, type RouteXY } from '../board'
import { rootScope, snapshot, sha256, type Produced } from '../kernel'
import { namespaceSpice } from './netlist'
import { branchSaves } from './branch-saves'
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
    const lines = [`${title}; JLC standard stackup (assumed)`, `.options klu reltol=1e-4 abstol=${options.currentToleranceA ?? 1e-9} vntol=1e-6 method=gear maxord=2 pivrel=0.1`, ...electrical.lines]
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
    // Only save receiver nodes and behavioural-source branch dependencies; the engine exposes the resulting vectors.
    const save = [...new Set(plan.probes.flatMap(probe => [probe.signalNode, probe.referenceNode]).filter(node => node !== '0'))].map(node => `v(${node})`).concat(saved).join(' ')
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
    const value = snapshot({ blockId: this.input.blockId, name: this.input.name, deck, requestSha256: sha256(JSON.stringify(routedRequest({ deck }))), probes: plan.probes, durationSeconds: options.durationSeconds, stepSeconds: options.stepSeconds, evidence })
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
  /** Coupling bands between parallel sections (width grows with k), ladder cells as ticks across the selected copper, and every modelled via with the shared glyph. */
  override visualize(): GraphicsObject {
    const { geometry, bindings, extracted } = this.input
    const circuit = bindings.circuitJson
    const view = routeView(circuit, bindings.scope)
    const drawing = routeBoardDrawing(circuit, bindings.scope)
    const built = this.output ? undefined : new Set(this.ladder?.wireNodes.keys() ?? [])
    /** A wire's position at `position` along its run, offset sideways to `transverse`. */
    const at = (wire: RouteWire, position: number, transverse: number): { x: number; y: number } => (([x, y]) => ({ x, y }))(routePosition({ ...wire, transverse }, position))
    const bands = extracted.slices
      .flatMap(slice => slice.wires.flatMap((a, i) => slice.wires.slice(i + 1).map((b, offset) => {
        const j = i + offset + 1
        const k = Math.max(Math.abs(slice.line.C[i][j]) / Math.sqrt(slice.line.C[i][i] * slice.line.C[j][j]), Math.abs(slice.line.L[i][j]) / Math.sqrt(slice.line.L[i][i] * slice.line.L[j][j]))
        return { slice, a, b, k }
      })))
      .filter(({ a, b, k }) => k >= 0.01 && (view.traces.has(a.trace) || view.traces.has(b.trace)) && (!built || (built.has(a.id) && built.has(b.id))))
      .sort((p, q) => q.k - p.k)
      .slice(0, 800)
    for (const { slice, a, b, k } of bands) {
      const middle = (a.transverse + b.transverse) / 2
      const half = (Math.max(0, Math.abs(a.transverse - b.transverse) - (a.width + b.width) / 2) / 2) * Math.min(1, k / 0.25)
      drawing.polygons!.push({ points: [at(a, slice.start, middle - half), at(a, slice.end, middle - half), at(a, slice.end, middle + half), at(a, slice.start, middle + half)], fill: routeTones.coupling, stroke: 'none', label: `k ${k.toFixed(2)}` })
    }
    const wires = new Map(geometry.wires.map(wire => [wire.id, wire]))
    const nodes = [...(this.ladder?.wireNodes ?? [])].flatMap(([id, samples]) => (view.traces.has(wires.get(id)?.trace ?? '') ? samples.map(sample => ({ wire: wires.get(id)!, position: sample.position })) : []))
    for (const { wire, position } of routeDisplayItems(nodes, 1500)) {
      const [x, y] = routePosition(wire, position)
      drawing.lines!.push({ points: [-1, 1].map(sign => ({ x: x - sign * wire.u[1] * wire.width * 1.4, y: y + sign * wire.u[0] * wire.width * 1.4 })), strokeColor: routeTones.cell, strokeWidth: wire.width * 0.3 })
    }
    for (const record of routeDisplayItems(this.obliqueRecords, 120)) {
      const pair = Array.isArray(record.wires) ? (record.wires as number[]).map(id => wires.get(id)) : []
      if (pair.length !== 2 || !pair[0] || !pair[1]) continue
      const near = closestRoutePoints(pair[0].a, pair[0].b, pair[1].a, pair[1].b)
      drawing.lines!.push({ points: [near.first, near.second].map(([x, y]) => ({ x, y })), strokeColor: routeTones.coupling, strokeWidth: view.unit * 0.3 })
    }
    const transitions = this.output?.value.evidence.transitions
    const physical = new Map(circuit.flatMap(item => (item.type === 'pcb_via' ? [[item.pcb_via_id, item] as const] : [])))
    const { minX, maxX, minY, maxY } = view.focus
    const selected = geometry.wires.filter(wire => view.traces.has(wire.trace))
    const width = selected.length ? selected.reduce((sum, wire) => sum + wire.width, 0) / selected.length : view.unit
    for (const record of Array.isArray(transitions) ? transitions : []) {
      const via = record.kind === 'via' ? physical.get(String(record.id)) : undefined
      if (via && via.x >= minX && via.x <= maxX && via.y >= minY && via.y <= maxY) routeVia(drawing, via, width * 1.4)
    }
    // The pane unrolls each net with its ladder cells as ticks and its coupling as violet under the bar.
    const unrolled = routeUnrolled(view, geometry.wires)
    const rows = new Map<string, RouteStripRow>(routeLengths(circuit, view).map(row => [row.net.label, { ...row, length: unrolled.lengths.get(row.net) ?? row.length, ticks: [], bands: [] }]))
    for (const { wire, position } of nodes) {
      const at = unrolled.along(wire.id, position)
      if (at) rows.get(at.net.label)?.ticks!.push(at.distance)
    }
    for (const { slice, a, b, k } of bands)
      for (const wire of [a, b]) {
        const [from, to] = [unrolled.along(wire.id, slice.start), unrolled.along(wire.id, slice.end)]
        if (from && to) rows.get(from.net.label)?.bands!.push({ from: from.distance, to: to.distance, k })
      }
    routeStrip(drawing, view.pane, [...rows.values()])
    if (this.failed) routeFailure(drawing, view.pane, this.error ?? 'Network rejected')
    return drawing
  }
}
