import { connectedSourceIds, segmentRoutes, routePosition, routeContactFrame, type LaneMapping, type RouteWire, type RouteXY } from '../board'
import { extractRoutes, type RouteMaterials } from '../extraction'
import { admitBuffers, compileBuffers, type IbisSources } from '../buffers'
import { rootScope } from '../kernel'
import { generalDeclarations, electricalSources, modelRunDefinition, namespaceSpice, routeLadder, routeTransitions, routeOblique, branchSaves, routedControl } from '../simulation'
import { endpointPorts, type PreparedBlock } from './signals'

/** Explicit material assumptions accompany every opt-in 2D run. */
export const assumedRouteMaterials: RouteMaterials = { maskMm: .02, maskEr: 3.3, maskLoss: .025, substrateLoss: .02 }

/** Compile physical route sections and original IBIS buffers into a bounded local transient deck. */
export function routedSimulation(block: PreparedBlock, sources: IbisSources, options: { riseSeconds: number; refinement: number; stepSeconds: number; durationSeconds: number; panels?: number; currentToleranceA?: number; cellsPerRise?: number }): {
  deck: string; evidence: Record<string, unknown>; geometry: ReturnType<typeof segmentRoutes>; extracted: ReturnType<typeof extractRoutes>
  probes: string[]; timings: Record<string, number>
} {
  const originalScope = block.settings.copperScope!
  const groundIds = connectedSourceIds(block.circuit, block.settings.channelReference!.sourcePortId!)
  const groundTraces = block.circuit.filter(record => record.type === 'source_trace').filter(trace => [...trace.connected_source_port_ids, ...trace.connected_source_net_ids ?? []].some(id => groundIds.has(id))).map(trace => trace.source_trace_id)
  const scope = { ...originalScope, nonReferenceRailTraceIds: [...originalScope.nonReferenceRailTraceIds, ...block.circuit.filter(record => record.type === 'pcb_trace').filter(trace => groundTraces.includes(trace.source_trace_id!)).map(trace => trace.pcb_trace_id)] }
  const maskLayers = block.circuit.filter(record => record.type === 'pcb_stackup')[0].layers.filter(layer => layer.layer_type === 'soldermask')
  if (new Set(maskLayers.map(layer => layer.thickness)).size > 1) throw new Error('Asymmetric soldermask thickness requires separate outer-layer material profiles')
  const materials = { ...assumedRouteMaterials, maskMm: maskLayers[0]?.thickness ?? assumedRouteMaterials.maskMm }
  const start = performance.now()
  const geometry = segmentRoutes(block.circuit, scope)
  const segmentation = performance.now() - start
  for (const lane of block.settings.lanes) for (const id of [lane.from.sourcePortId!, lane.to.sourcePortId!]) {
    const port = block.circuit.find(record => record.type === 'pcb_port' && record.source_port_id === id)! as Extract<typeof block.circuit[number], { type: 'pcb_port' }>
    if (!port.layers.some(layer => routeContactFrame(geometry, scope, layer, [port.x, port.y]))) throw new Error(`${lane.port}: selected endpoint ${id} has no physical wire or via contact`)
  }
  const extractionAt = performance.now()
  let extracted: ReturnType<typeof extractRoutes>
  try {
    extracted = extractRoutes(geometry, materials, options.panels)
  } catch (error) {
    throw Object.assign(error as Error, { segmentationMilliseconds: segmentation, sectionGeometryMilliseconds: performance.now() - extractionAt - ((error as { solveMilliseconds?: number }).solveMilliseconds ?? 0) })
  }
  const compiledAt = performance.now()
  // Cut every physical non-rail route out of the logical ideal netlist, including branched neighbours.
  const physical = block.circuit.filter(record => record.type === 'pcb_trace').filter(trace => scope.pcbTraceIds.includes(trace.pcb_trace_id) && !scope.nonReferenceRailTraceIds.includes(trace.pcb_trace_id)).map(trace => trace.source_trace_id!)
  const mappings: LaneMapping[] = block.signals.flatMap(signal => signal.receivers.flatMap(receiver => endpointPorts(receiver).map((to, i) => {
    const from = endpointPorts(signal.driver)[i]
    const lane = block.settings.lanes.find(lane => lane.from.sourcePortId === from || lane.to.sourcePortId === from)!
    return { port: signal.name, from, to, sourceTraceId: lane.sourceTraceId!, pcbTraceId: '', pcbPorts: [], stages: [], originalRoute: [] }
  })))
  mappings[0].sourceTraceIds = physical
  const declarations = generalDeclarations(block.circuit, { mappings }, block.settings)
  const plan = declarations.plans[0]
  plan.durationSeconds = options.durationSeconds
  plan.maxStepSeconds = options.stepSeconds
  const electrical = electricalSources(block.circuit, block.settings, declarations.nodes)
  const admitted = admitBuffers(declarations.models, sources, {}, rootScope('buffers')).value
  const models = compileBuffers(admitted, [plan], modelRunDefinition)[0]
  const bufferMilliseconds = performance.now() - compiledAt
  const netlistAt = performance.now()
  const aliases: string[] = []
  const known = new Map<string, string>()
  /** Coordinates join actual physical copper only; no straightening or whole-net ideal bypass. */
  const key = (layer: string, point: RouteXY): string => `${layer}:${point.map(n => n.toFixed(6)).join(',')}`
  for (const port of block.circuit.filter(record => record.type === 'pcb_port')) for (const layer of port.layers) {
    if (!routeContactFrame(geometry, scope, layer, [port.x, port.y])) continue
    const id = key(layer, [port.x, port.y])
    const node = declarations.nodes.node(port.source_port_id)
    const previous = known.get(id)
    if (previous && previous !== node) aliases.push(`RALIAS${aliases.length} ${previous} ${node} 1e-6`)
    else known.set(id, node)
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
  const ladder = routeLadder(extracted, endpoint, options.riseSeconds, options.refinement, options.cellsPerRise)
  const oblique = routeOblique(geometry, extracted, ladder, scope, materials, options.panels)
  const transitions = routeTransitions(block.circuit, scope, geometry, endpoint, declarations.nodes.groundSourcePortId)
  const lines = ['Routed quasi-TEM coupled 2D extraction; JLC standard stackup (assumed)', `.options klu reltol=1e-4 abstol=${options.currentToleranceA ?? 1e-9} vntol=1e-6 method=gear maxord=2`, ...electrical.lines]
  const saved: string[] = []
  for (const [i, model] of models.entries()) {
    const namespaced = namespaceSpice(model.source, `I${i}`)
    const header = model.source.match(/^\.subckt\s+\S+\s+(.+)$/mi)!
    const nodes = header[1].trim().split(/\s+/).map(terminal => declarations.nodes.node(model.spicePinMapping[terminal]))
    saved.push(...branchSaves(namespaced.source, `XIBIS${i}`, namespaced.wrapper))
    lines.push(namespaced.source, `XIBIS${i} ${nodes.join(' ')} ${namespaced.wrapper}`)
  }
  for (const collection of [aliases, ladder.lines, oblique.lines, transitions.lines]) for (const line of collection) lines.push(line)
  const biasNodes = [...new Set([...ladder.wireNodes.values()].flatMap(records => records.map(record => record.node)).concat(models.flatMap(model => Object.values(model.spicePinMapping).map(port => declarations.nodes.node(port)))))].filter(node => node !== '0')
  for (const [i, node] of biasNodes.entries()) lines.push(`RBIAS${i} ${node} 0 1e9`)
  for (const probe of [...plan.probes].filter(probe => probe.referenceNode !== '0')) {
    for (const [suffix, signalNode, signalSourceId] of [['P', probe.signalNode, probe.signalSourceId], ['N', probe.referenceNode, probe.referenceSourceId]] as const) plan.probes.push({ ...probe, name: `${probe.name}_${suffix}`, simulationVoltageProbeId: `${probe.simulationVoltageProbeId}_${suffix}`, column: plan.probes.length + 1, signalNode, signalSourceId: signalSourceId!, referenceNode: '0', referenceSourceId: declarations.nodes.groundSourcePortId })
  }
  // Only save receiver nodes and behavioural-source branch dependencies; vectors are released after wrdata.
  const probes = plan.probes.map(probe => probe.name)
  const save = [...new Set(plan.probes.flatMap(probe => [probe.signalNode, probe.referenceNode]).filter(node => node !== '0'))].map(node => `v(${node})`).concat(saved).join(' ')
  lines.push(...routedControl(plan.probes, save, options.stepSeconds, options.durationSeconds))
  const ground = connectedSourceIds(block.circuit, declarations.nodes.groundSourcePortId)
  const powerReferences = geometry.slices.flatMap(slice => slice.references.filter(plane => !ground.has(plane.net)).map(plane => ({ plane, traces: slice.wires.map(wire => wire.trace), start: slice.start, end: slice.end })))
  const mapped = new Set(models.flatMap(model => Object.values(model.spicePinMapping)))
  const external = block.circuit.filter(record => record.type === 'pcb_port').filter(port => !mapped.has(port.source_port_id) && port.layers.some(layer => routeContactFrame(geometry, scope, layer, [port.x, port.y])))
  const warnings = [...extracted.warnings, ...transitions.warnings, ...models.flatMap(model => model.warnings),
    `JLC standard stackup (assumed): JLC08121H-3313; mask thickness ${materials.maskMm} mm (${maskLayers.length ? 'preset' : 'assumed; absent from preset'}). Mask er=3.3, tan(delta)=0.025 and laminate tan(delta)=0.02 assumed.`,
    'Numerical DC anchors: 1 Gohm per coarse route node; removes open-neighbour common-mode singularities without substituting a vendor load.',
    'Coplanar pours are not discretized into finite strip conductors; actual pours supply vertical references only. Their lateral shielding/coupling remains unqualified.',
    'Absent copper-layer volume is filled with nearest laminate; copper roughness, etch trapezoids and bend excess capacitance omitted.',
    'Oblique corrections apply selected-net to scoped-neighbour encounters within the same/adjacent layers; neighbour-to-neighbour oblique coupling is omitted. Added pair C uses existing isolated self C, a weak-coupling approximation. Placement is at the nearest ladder node; spacing is rounded outward to 1 um.',
    'Oblique surrogate blocked by an intervening local infinite reference plane is recorded as shielded, with plane-edge/aperture fringing omitted.',
    'Power rail wires are ideal AC electrodes: their longitudinal impedance and power-plane impedance are omitted.',
    `${external.length} external neighbour port bodies have open/ideal-logical terminations without additional vendor die models; actual endpoint IDs are recorded. This is a candidate channel experiment, not a complete board/PDN simulation.`]
  return { deck: lines.join('\n') + '\n', geometry, extracted, probes,
    timings: { segmentation_ms: segmentation, section_geometry_ms: extracted.geometryMilliseconds, solves_ms: extracted.solveMilliseconds + oblique.solveMilliseconds, oblique_solves_ms: oblique.solveMilliseconds, buffers_ms: bufferMilliseconds, netlist_ms: performance.now() - netlistAt - oblique.solveMilliseconds },
    evidence: { endpoint_nodes: Object.fromEntries(mappings.flatMap(mapping => [[mapping.from, declarations.nodes.node(mapping.from)], [mapping.to, declarations.nodes.node(mapping.to)]])), probes: plan.probes, label: 'JLC standard stackup (assumed)', materials, mask_thickness_source: maskLayers.length ? 'preset' : 'assumed', options, scope, warnings, cells: ladder.cells, maximum_cell_delay_s: ladder.maximumDelaySeconds,
      unique_cross_sections: extracted.cache.size + oblique.solves, oblique_cross_sections: oblique.solves, oblique_encounters: oblique.records, sections: extracted.slices.length, geometry_wires: geometry.wires.length, wires: geometry.wires, via_contacts: geometry.viaContacts,
      power_references: powerReferences, copper_overlap_patches: geometry.wires.filter(wire => wire.joins?.length), transitions: transitions.records, external_open_ports: external.map(port => port.source_port_id),
      assembly: models.map(model => ({ name: model.name, metadata: model.metadata, warnings: model.warnings, sourceEvidence: model.sourceEvidence })),
      routes: mappings.map(mapping => ({ ...mapping, length_mm: geometry.wires.filter(wire => wire.source === mapping.sourceTraceId).reduce((sum, wire) => sum + wire.end - wire.start, 0) })),
      cross_sections: [...extracted.cache].map(([key, line]) => ({ geometry: JSON.parse(key), C: line.C, L: line.L, dcResistance: line.dcResistance, skinResistance: line.skinResistance, dielectricLoss: line.dielectricLoss, diagnostics: line.diagnostics })),
      slices: extracted.slices.map(slice => ({ start: slice.start, end: slice.end, point: routePosition(slice.wires[0], (slice.start + slice.end) / 2), wires: slice.wires.map(wire => wire.id), references: slice.references, key: slice.key })) } }
}
