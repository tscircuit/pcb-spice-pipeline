import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fullBoardDdr3 } from '../tests/support/full-board-ddr3'
import { channelCopperScope, connectedSourceIds, copperScopeRejections, validateCircuitRecords } from '../src/board'
import { endpointPorts, prepareBlocks, routedLanes } from '../src/pipeline/signals'
import { signalTopology } from '../src/pipeline/topology'
import { admit, declare, bind } from '../src/pipeline/stages'

const path = process.env.SI_DDR3_BOARD
if (!path || !process.env.IBIS_MODEL_DIR) throw new Error('Set SI_DDR3_BOARD and IBIS_MODEL_DIR; board JSON and vendor bytes remain local')
const bytes = await readFile(path)
const circuit = await fullBoardDdr3(path)
const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR}/${file}`)] as const)))
const signals = circuit.filter(record => record.type === 'simulation_signal')
const models = circuit.filter(record => record.type === 'simulation_ibis_model')
const rails = new Set<string>()
for (const id of circuit.filter(record => record.type === 'source_net').filter(net => net.is_ground || net.is_power).map(net => net.source_net_id)
  .concat(models.flatMap(model => Object.values(model.ibis_pin_name_to_reference_source_port_ids ?? {}).flatMap(refs => Object.values(refs).filter((id): id is string => !!id))))) {
  if (!rails.has(id)) for (const member of connectedSourceIds(circuit, id)) rails.add(member)
}
const topology = new Map(signals.flatMap(signal => endpointPorts(signal.driver).flatMap(port => [...signalTopology(circuit, port, rails)].map(id => [id, signal.name] as const))))
const reference = models[0].ibis_pin_name_to_source_port_id.A1
const ground = connectedSourceIds(circuit, reference)
const scope = channelCopperScope(circuit, new Set(topology.keys()), ground, rails)
const routed = routedLanes(circuit, scope, topology, new Set(signals.flatMap(signal => endpointPorts(signal.driver))), rails)
const sourceTraces = circuit.filter(record => record.type === 'source_trace')
const pcbTraces = circuit.filter(record => record.type === 'pcb_trace')
const vias = circuit.filter(record => record.type === 'pcb_via')
const pours = circuit.filter(record => record.type === 'pcb_copper_pour')
const sourcePorts = circuit.filter(record => record.type === 'source_port')
const components = circuit.filter(record => record.type === 'source_component')
/** Resolve human pin identity for evidence, retaining IDs separately in the scope. */
const pinName = (id: string): string => {
  const port = sourcePorts.find(port => port.source_port_id === id)!
  return `${components.find(component => component.source_component_id === port.source_component_id)?.name ?? 'via'}.${port.name}`
}
const lane = scope.selectedPcbTraceIds.map(id => {
  const pcb = pcbTraces.find(trace => trace.pcb_trace_id === id)!
  const source = sourceTraces.find(trace => trace.source_trace_id === pcb.source_trace_id)!
  return { name: source.name, pcb_trace_id: id, endpoints: source.connected_source_port_ids.map(pinName),
    layers: [...new Set(pcb.route.flatMap(p => p.route_type === 'wire' ? [p.layer] : p.route_type === 'via' ? [p.from_layer, p.to_layer] : [p.start_layer, p.end_layer]))],
    vias: vias.filter(via => via.pcb_trace_id === id || via.source_trace_id === source.source_trace_id).map(via => ({ id: via.pcb_via_id, layers: via.layers, hole_mm: via.hole_diameter, pad_mm: via.outer_diameter })) }
})
const passed: string[] = []
let firstError: string | null = null
let warnings: string[] = []
try {
  validateCircuitRecords(circuit)
  passed.push('Circuit JSON schema')
  const [block] = prepareBlocks(circuit, sources)
  passed.push('prepareBlocks')
  const context = { progress: (): void => {} }
  const admitted = (await admit.run({ phase: 'input', options: { circuitJson: block.circuit, modeling: block.settings, ibisSources: sources } }, context)).state
  passed.push('admit')
  const declared = (await declare.run(admitted, context)).state
  passed.push('declare')
  await bind.run(declared, context)
  passed.push('bind')
} catch (error) {
  firstError = (error as Error).message
  warnings = (error as Error & { warnings?: string[] }).warnings ?? []
}

// Independent gates below are audited on copies. They do not establish later stage passage.
const independent: { boundary: string; errors: string[] }[] = [{ boundary: 'routed lane shape', errors: routed.rejections }]
try {
  const { stackupFromCircuitJson } = await import('../src/board')
  stackupFromCircuitJson(circuit)
} catch (error) { independent.push({ boundary: 'physical stackup', errors: [(error as Error).message] }) }
independent.push({ boundary: 'retained copper capability', errors: copperScopeRejections(scope) })
const groundPours = pours.filter(pour => pour.source_net_id && ground.has(pour.source_net_id))
if (groundPours.length > 1) independent.push({ boundary: 'return connectivity', errors: ['Reference leads must reach one connected pour; inter-pour stitching extraction is not supported'] })
const bindings = new Set(models.flatMap(model => Object.values(model.ibis_pin_name_to_source_port_id)))
const unbound = routed.lanes.flatMap(route => [route.from.sourcePortId!, route.to.sourcePortId!]).filter(id => !bindings.has(id))
const summary = { board_path: path, board_sha256: createHash('sha256').update(bytes).digest('hex'),
  source_sha256: Object.fromEntries(Object.entries(sources).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
  native_solver_calls: 0, warnings, passed_stages: passed, first_error: firstError, independent_gates: independent,
  board: circuit.find(record => record.type === 'pcb_board'), counts: Object.fromEntries(['source_component', 'pcb_trace', 'pcb_via', 'pcb_copper_pour'].map(type => [type, circuit.filter(record => record.type === type).length])),
  scope, selected_lane: lane, two_port_candidate_conductors: routed.lanes.length, two_port_neighbour_candidates: routed.lanes.length - lane.length,
  unbound_endpoint_inventory: [...new Set(unbound)].map(id => {
    const port = sourcePorts.find(port => port.source_port_id === id)!
    const component = components.find(component => component.source_component_id === port.source_component_id)
    return { id, pin: pinName(id), supported_passive: !!component && ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(component.ftype) }
  }),
  unsupported_route_records: sourceTraces.filter(trace => pcbTraces.some(pcb => pcb.source_trace_id === trace.source_trace_id && scope.pcbTraceIds.includes(pcb.pcb_trace_id)) && trace.connected_source_port_ids.length !== 2 && ![...trace.connected_source_port_ids, ...(trace.connected_source_net_ids ?? [])].some(id => rails.has(id))),
  retained_pours: pours.filter(pour => scope.pcbCopperPourIds.includes(pour.pcb_copper_pour_id)).map(pour => ({ id: pour.pcb_copper_pour_id, layer: pour.layer, net: circuit.filter(record => record.type === 'source_net').find(net => net.source_net_id === pour.source_net_id)?.name, shape: pour.shape,
    rings: pour.shape === 'brep' ? 1 + pour.brep_shape.inner_rings.length : null, vertices: pour.shape === 'brep' ? pour.brep_shape.outer_ring.vertices.length + pour.brep_shape.inner_rings.reduce((sum, ring) => sum + ring.vertices.length, 0) : null })),
  reference_vias: vias.filter(via => via.source_net_id && ground.has(via.source_net_id) || sourceTraces.some(trace => trace.source_trace_id === via.source_trace_id && [...trace.connected_source_port_ids, ...(trace.connected_source_net_ids ?? [])].some(id => ground.has(id)))).map(via => ({ id: via.pcb_via_id, layers: via.layers })),
}
await mkdir('runs', { recursive: true })
await writeFile('runs/full-board-ddr3-boundary.json', JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ passed_stages: passed, first_error: firstError, independent_gates: independent, scoped_traces: scope.pcbTraceIds.length, conductors_with_supported_shape: routed.lanes.length, selected_lane: lane, unbound_endpoint_inventory: summary.unbound_endpoint_inventory, native_solver_calls: 0 }, null, 2))
