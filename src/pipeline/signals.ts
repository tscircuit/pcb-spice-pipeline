import { isQuiet, channelCopperScope, connectedSourceIds, stackupFromCircuitJson, type CircuitJson, type SignalEndpoint, type SimulationSignal, type SimulationSignalIntegrity } from '../board'
import { inspectPins, edgeSeconds, referenceVoltages, coupledPackage, packageCapacitanceWarnings, type InspectedPin, type IbisSources } from '../buffers'
import { safeId, sha256 } from '../kernel'
import type { NumericalSettings } from './modeling'
import { signalTopology, validateSignalGraph } from './topology'
import { compareNames, recordingTime } from './timing'
import { pinCapabilities } from '../buffers'

export interface PreparedBlock {
  duration: number; topology: Map<string, Set<string>>;
  block: SimulationSignalIntegrity; signals: SimulationSignal[]; circuit: CircuitJson
  pins: Map<string, InspectedPin>; settings: NumericalSettings
  warnings: string[]
}
/** Ordered physical ports: the sign of a differential signal is P minus N. */
export function endpointPorts(endpoint: SignalEndpoint): string[] {
  return 'source_port_id' in endpoint ? [endpoint.source_port_id] : [endpoint.p_source_port_id, endpoint.n_source_port_id]
}
/** Seeded PRBS generation bounded by the actual requested recording; never allocate a full PRBS31 period. */
export function signalBits(signal: SimulationSignal, duration: number): string {
  const order = /^prbs(7|15|31)$/.exec(signal.pattern)
  const width = Number(order?.[1])
  const mask = 2 ** width - 1
  if (order && (!Number.isInteger(signal.seed) || signal.seed! < 1 || signal.seed! > mask)) throw new Error(`Signal "${signal.name}": ${signal.pattern} seed must be an integer in 1..${mask}.`)
  if (signal.driver_disabled) return '0'
  if (signal.pattern === 'clock') return '01'
  if (!order) {
    if (!/^[01]+$/.test(signal.pattern)) throw new Error(`${signal.name}: pattern must be PRBS, clock, or a literal bit string`)
    return signal.pattern
  }
  let state = signal.seed!
  const count = Math.min(mask, Math.ceil(Math.max(0, duration - signal.offset_s) * signal.bit_rate_bps) + 1)
  const tap = width === 7 ? 6 : width === 15 ? 14 : 28
  let bits = ''
  for (let i = 0; i < count; i++) {
    bits += String((state >>> (width - 1)) & 1)
    state = ((state << 1) | (((state >>> (width - 1)) ^ (state >>> (tap - 1))) & 1)) & mask
  }
  return bits
}
/** Audit only selected/nearby routed nets; unsupported neighbours remain visible. */
export function routedLanes(circuit: CircuitJson, scope: import('../board').CopperScope, topology: Map<string, string>, driven: Set<string>, rails: Set<string>): { lanes: NumericalSettings['lanes']; rejections: string[] } {
  const lanes: NumericalSettings['lanes'] = []
  const rejections: string[] = []
  for (const trace of circuit.filter(r => r.type === 'source_trace').sort((a, b) => a.source_trace_id.localeCompare(b.source_trace_id))) {
    const ports = trace.connected_source_port_ids
    const pcb = circuit.filter(r => r.type === 'pcb_trace').filter(r => r.source_trace_id === trace.source_trace_id)
    if (!pcb.some(route => scope.pcbTraceIds.includes(route.pcb_trace_id)) || [...ports, ...(trace.connected_source_net_ids ?? [])].some(port => rails.has(port))) continue
    if (ports.length !== 2 || pcb.length !== 1) {
      rejections.push(`Signal "${topology.get(ports[0]) ?? trace.name ?? trace.display_name ?? trace.source_trace_id}": branched routed graphs are not implemented yet.`)
      continue
    }
    const ordered = [...ports].sort()
    if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
    lanes.push({ port: topology.get(ordered[0]) ? `${topology.get(ordered[0])}_${trace.source_trace_id}` : `passive_${trace.source_trace_id}`, from: { sourcePortId: ordered[0] }, to: { sourcePortId: ordered[1] }, sourceTraceId: trace.source_trace_id })
  }
  return { lanes, rejections }
}
/** Validate blocks and lower test intent to the private native-solver declarations. */
export function prepareBlocks(circuitJson: CircuitJson, sources: IbisSources, extraction: '3d' | '2d' = '3d', distanceMm: number = extraction === '2d' ? 32 : 1): PreparedBlock[] {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0 || distanceMm > 32) throw new Error('Copper scope distance must be in (0,32] mm')
  const blocks = signalBlocks(circuitJson)
  return blocks.map(block => prepareBlockById(circuitJson, sources, block.simulation_signal_integrity_id, extraction, distanceMm))
}
/** Validate the shared block namespace before any independent block work. */
export function signalBlocks(circuitJson: CircuitJson): SimulationSignalIntegrity[] {
  const blocks = circuitJson.filter(r => r.type === 'simulation_signal_integrity')
  if (blocks.length > 1 && blocks.some(block => !block.name)) throw new Error(`This board has ${blocks.length} <simulation.pcbtransientchannelsimulation> blocks; give each a name.`)
  const ids = new Set(blocks.map(b => b.simulation_signal_integrity_id))
  if (ids.size !== blocks.length) throw new Error('Duplicate simulation_signal_integrity identifier')
  for (const signal of circuitJson.filter(r => r.type === 'simulation_signal')) if (!ids.has(signal.simulation_signal_integrity_id)) throw new Error(`${signal.name}: unknown signal-integrity block`)
  return blocks
}
/** Admit exactly one block through the same lowering used by prepareBlocks. */
export function prepareBlockById(circuit: CircuitJson, sources: IbisSources, blockId: string, extraction: '3d' | '2d' = '3d', distanceMm: number = extraction === '2d' ? 32 : 1): PreparedBlock {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0 || distanceMm > 32) throw new Error('Copper scope distance must be in (0,32] mm')
  const matches = signalBlocks(circuit).filter(block => block.simulation_signal_integrity_id === blockId)
  if (matches.length !== 1) throw new Error(`Expected exactly one signal-integrity block ${blockId}`)
  const warnings: string[] = []
  try {
    return prepareBlock(circuit, matches[0], sources, warnings, extraction, distanceMm)
  } catch (error) {
    throw Object.assign(error as Error, { warnings })
  }
}
/** Independent block: model overrides, copper, pin states, references and stimuli. */
function prepareBlock(input: CircuitJson, block: SimulationSignalIntegrity, sources: IbisSources, warnings: string[], extraction: '3d' | '2d', distanceMm: number): PreparedBlock {
  const id = safeId(block.simulation_signal_integrity_id, 'simulationSignalIntegrityId')
  const signals = input.filter(r => r.type === 'simulation_signal').filter(r => r.simulation_signal_integrity_id === id).sort((a, b) => compareNames(a.name, b.name))
  if (!signals.length || new Set(signals.map(s => s.name)).size !== signals.length || new Set(signals.map(s => s.simulation_signal_id)).size !== signals.length) throw new Error(`${block.name ?? id}: require distinct named signals`)
  const timing = recordingTime(signals)
  const duration = block.duration_s ?? timing.duration
  const circuit = structuredClone(input.filter(r => !r.type.startsWith('simulation_') || ['simulation_ibis_model', 'simulation_voltage_source', 'simulation_spice_subcircuit'].includes(r.type)))
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    for (const signal of signals) for (const endpoint of [signal.driver, ...signal.receivers]) {
      for (const [index, port] of endpointPorts(endpoint).entries()) {
        const selected = 'source_port_id' in endpoint ? endpoint.ibis_model_name : index === 0 ? endpoint.p_ibis_model_name : endpoint.n_ibis_model_name
        if (!selected) continue
        for (const [pin, target] of Object.entries(model.ibis_pin_name_to_source_port_id)) if (target === port) {
          model.ibis_pin_name_to_model_name = { ...model.ibis_pin_name_to_model_name, [pin]: selected }
        }
      }
    }
  }
  const pins = inspectPins(circuit, sources)
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    const inspected = [...pins.values()].filter(pin => pin.model === model)
    if (!inspected.length || inspected[0].component.coupledPackage === undefined) continue
    const references = new Set(inspected.flatMap(pin => [pin.power, pin.ground, ...Object.values(model.ibis_pin_name_to_reference_source_port_ids?.[pin.pin] ?? {})]))
    const selected = Object.entries(model.ibis_pin_name_to_source_port_id).filter(([pin, port]) => inspected.some(signal => signal.pin === pin) || references.has(port)).map(([pin]) => pin)
    const file = model.ibis_model_asset.project_relative_path
    warnings.push(...packageCapacitanceWarnings(coupledPackage(inspected[0].text, inspected[0].component, selected), file, sha256(sources[file])))
  }
  const rails = new Set<string>()
  for (const port of [...pins.values()].flatMap(pin => [pin.ground, pin.power]).concat(circuit.filter(record => record.type === 'source_net').filter(net => net.is_ground || net.is_power).map(net => net.source_net_id))) {
    if (!rails.has(port)) for (const connected of connectedSourceIds(circuit, port)) rails.add(connected)
  }
  for (const pin of pins.values()) {
    const model = pin.model
    model.ibis_pin_name_to_reference_source_port_ids ??= {}
    model.ibis_pin_name_to_reference_source_port_ids[pin.pin] ??= { pullup_reference_source_port_id: pin.power, power_clamp_reference_source_port_id: pin.power, pulldown_reference_source_port_id: pin.ground, ground_clamp_reference_source_port_id: pin.ground }
  }
  const driven = new Map<string, SimulationSignal>()
  const topology = new Map<string, string>()
  const edges: number[] = []
  for (const signal of signals) {
    safeId(signal.simulation_signal_id, 'simulationSignalId')
    const drivers = endpointPorts(signal.driver)
    for (const port of drivers) {
      const pin = pins.get(port)
      if (!pin) throw new Error(`Signal "${signal.name}" driver ${port} has no <simulation.ibismodel>.`)
      const capabilities = pinCapabilities(pin)
      if (!capabilities.drive) throw new Error(`${port}: selected model does not support driving on this pin.`)
      if (signal.driver_disabled && !capabilities.disable) throw new Error(`Signal "${signal.name}": ${port} model ${pin.buffer.name} has no disabled state; use pattern="0" or "1".`)
      driven.set(port, signal)
      edges.push(edgeSeconds(pin))
      for (const net of signalTopology(circuit, port, rails)) {
        const owner = topology.get(net)
        if (owner && owner !== signal.name) throw new Error(`Signals "${owner}" and "${signal.name}" are on the same net; one signal per net.`)
        topology.set(net, signal.name)
      }
    }
    for (const receiver of signal.receivers) {
      if (('source_port_id' in receiver) !== ('source_port_id' in signal.driver)) throw new Error(`${signal.name}: driver and receiver must use the same endpoint shape`)
      for (const [index, port] of endpointPorts(receiver).entries()) {
        if (!pins.has(port)) throw new Error(`Signal "${signal.name}" receiver ${port} has no <simulation.ibismodel>.`)
        if (!pinCapabilities(pins.get(port)!).receive) throw new Error(`${port}: selected model does not support receiving on this pin.`)
        if (!signalTopology(circuit, drivers[index], rails).has(port)) throw new Error(`Receiver ${port} is not connected to the copper of signal "${signal.name}".`)
      }
    }
    if ('p_source_port_id' in signal.driver) for (const endpoint of [signal.driver, ...signal.receivers]) {
      const [p, n] = endpointPorts(endpoint).map(port => pins.get(port)!)
      const pair = p.component.differentialPins.find(pair => pair.pin === p.pin && pair.invertedPin === n.pin)
      if (p.model.source_component_id !== n.model.source_component_id) throw new Error(`Signal "${signal.name}": both differential legs must belong to the same chip.`)
      if (!pair) throw new Error(`Signal "${signal.name}": differential pin order disagrees with IBIS [Diff_pin]; swap p and n or repair the model mapping.`)
      // The vendor's model Polarity is already applied by the converter.
    }
  }
  validateSignalGraph(circuit, signals, rails, block.allow_unrouted_traces)
  const edge = Math.min(...edges)
  const rate = Math.max(...signals.map(s => s.bit_rate_bps))
  const step = Math.min(1 / rate / 100, edge / 20)
  const reference = pins.get([...driven.keys()].sort()[0])!.ground
  const lanes: NumericalSettings['lanes'] = []
  const copperScope = channelCopperScope(circuit, new Set(topology.keys()), connectedSourceIds(circuit, reference), rails, distanceMm)
  for (const port of circuit.filter(r => r.type === 'source_port').filter(port => topology.has(port.source_port_id) && !pins.has(port.source_port_id))) {
    const component = circuit.filter(r => r.type === 'source_component').find(component => component.source_component_id === port.source_component_id)
    if (!component || (!['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(component.ftype) && !circuit.some(r => r.type === 'simulation_spice_subcircuit' && r.source_component_id === component.source_component_id))) throw new Error(`${component?.name ?? port.source_port_id} is on the signal and has no supported SPICE or IBIS model.`)
  }
  const routed = routedLanes(circuit, extraction === '2d' ? { ...copperScope, pcbTraceIds: copperScope.selectedPcbTraceIds } : copperScope, topology, new Set(driven.keys()), rails)
  if (routed.rejections.length) throw Object.assign(new Error(routed.rejections[0]), { rejections: routed.rejections, copperScope })
  lanes.push(...routed.lanes)
  for (const signal of signals) for (const port of endpointPorts(signal.driver)) if (!lanes.some(l => l.from.sourcePortId === port || l.to.sourcePortId === port)) {
    if (!block.allow_unrouted_traces) throw new Error(`Signal "${signal.name}" is not routed from ${port}.`)
  }
  if (!lanes.length && !block.allow_unrouted_traces) throw new Error('At least one routed conductor is required for native extraction')
  // Stable physical endpoint identities order the matrix; route coordinates set coupling.
  lanes.sort((a, b) => a.from.sourcePortId!.localeCompare(b.from.sourcePortId!))
  const retained = new Set(topology.keys())
  if (extraction === '2d') for (const trace of circuit.filter(record => record.type === 'source_trace')) {
    if (circuit.some(record => record.type === 'pcb_trace' && record.source_trace_id === trace.source_trace_id && copperScope.pcbTraceIds.includes(record.pcb_trace_id)))
      for (const port of trace.connected_source_port_ids) for (const id of connectedSourceIds(circuit, port)) retained.add(id)
  }
  for (const lane of lanes) for (const port of [lane.from.sourcePortId!, lane.to.sourcePortId!]) for (const id of connectedSourceIds(circuit, port)) retained.add(id)
  for (const [port] of pins) if (!retained.has(port)) pins.delete(port)
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    const used = [...pins.values()].filter(pin => pin.model === model)
    const ports = new Set(used.flatMap(pin => [pin.port, pin.power, pin.ground, ...Object.values(model.ibis_pin_name_to_reference_source_port_ids?.[pin.pin] ?? {})]))
    model.ibis_pin_name_to_source_port_id = Object.fromEntries(Object.entries(model.ibis_pin_name_to_source_port_id).filter(([, port]) => ports.has(port)))
    if (!used.length) circuit.splice(circuit.indexOf(model), 1)
  }
  const stack = stackupFromCircuitJson(circuit)
  if (!stack.relativePermittivity) throw new Error('<simulation.pcbtransientchannelsimulation> needs explicit stackup dielectric constants.')
  const routes = circuit.filter(r => r.type === 'pcb_trace').filter(r => lanes.some(l => l.sourceTraceId === r.source_trace_id))
  const length = Math.max(...routes.map(route => route.route.slice(1).reduce((sum, p, i) => sum + ('x' in p && 'x' in route.route[i] ? Math.hypot(p.x - route.route[i].x!, p.y - route.route[i].y!) : 0), 0)))
  const gap = Math.min(...stack.dielectrics.map(layer => layer.zMaxMm - layer.zMinMm))
  const wireWidth = routes.length ? Math.min(...routes.flatMap(route => route.route.filter(point => point.route_type === 'wire').map(point => point.width))) : Math.min(...stack.copperLayers.map(layer => layer.zMaxMm - layer.zMinMm))
  const mesh = Math.max(gap, wireWidth * 2)
  const modelHz = Number(Math.max(rate / 2, .5 / edge).toPrecision(3))
  const decade = Math.ceil(Math.log10(modelHz))
  // Deck generation sizes width and thickness independently from skin depth.
  const filaments = 3
  const groundCandidates = [...new Set(signals.flatMap(signal => signal.receivers.flatMap(endpointPorts)).map(port => pins.get(port)!.ground))].sort()
  const settings: NumericalSettings = {
    measurementGate: Math.min(timing.gate, duration / 2), reduction: 'routed-copper', allowIdeal: block.allow_unrouted_traces, simplifyParallel: true, sections: Math.max(2, Math.ceil(length / 1000 * Math.sqrt(stack.relativePermittivity) / 299792458 / edge * 10)),
    lanes, copperScope, channelReference: { sourcePortId: reference }, groundReturn: { sourcePortId: groundCandidates[0] },
    relativePermittivity: stack.relativePermittivity,
    extraction: { minimumHz: modelHz / 10 ** decade, modelHz, maximumHz: modelHz, filaments, refinementFilaments: filaments + 4,
      convergenceTolerance: .05, capTolerance: .02, reciprocityTolerance: .025, dcResistanceTolerance: .002,
      maxPanelLengthMm: mesh * 2, groundMeshMm: mesh },
    passiveComponents: circuit.filter(r => r.type === 'source_component').filter(r => (['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype) || circuit.some(model => model.type === 'simulation_spice_subcircuit' && model.source_component_id === r.source_component_id)) && circuit.some(port => port.type === 'source_port' && port.source_component_id === r.source_component_id && !rails.has(port.source_port_id) && lanes.some(lane => connectedSourceIds(circuit, lane.from.sourcePortId!).has(port.source_port_id) || connectedSourceIds(circuit, lane.to.sourcePortId!).has(port.source_port_id)))).map(r => ({ sourceComponentId: r.source_component_id })),
  }
  if (copperScope.pcbViaIds.length) {
    if (!stack.viaPlatingMm) throw new Error('pcb_stackup must specify plated_hole_copper_thickness for routed vias')
    settings.viaPlatingMm = stack.viaPlatingMm
    settings.viaEquivalentWidthMm = Math.min(...circuit.filter(r => r.type === 'pcb_via').filter(r => copperScope.pcbViaIds.includes(r.pcb_via_id)).map(v => v.hole_diameter + 2 * stack.viaPlatingMm!))
    settings.omitThroughViaStubs = true
  }
  const values = new Map<string, number>()
  for (const pin of pins.values()) {
    const voltages = referenceVoltages(pin.buffer)
    const refs = pin.model.ibis_pin_name_to_reference_source_port_ids![pin.pin]
    const ports = { pullup: refs.pullup_reference_source_port_id ?? pin.power, pulldown: refs.pulldown_reference_source_port_id ?? pin.ground, powerClamp: refs.power_clamp_reference_source_port_id ?? pin.power, groundClamp: refs.ground_clamp_reference_source_port_id ?? pin.ground }
    const net = [...connectedSourceIds(circuit, pin.power)].sort().join(',')
    const supplied = values.has(net)
    for (const [role, voltage] of Object.entries(voltages)) {
      const key = [...connectedSourceIds(circuit, ports[role as keyof typeof ports])].sort().join(',')
      if (values.has(key) && Math.abs(values.get(key)! - voltage) > 1e-8) throw new Error(`${pin.port}: shared reference has incompatible IBIS typical voltages.`)
      values.set(key, voltage)
    }
    if (!supplied) {
      settings.supplies ??= []
      settings.supplies.push({ positive: { sourcePortId: pin.power }, negative: { sourcePortId: pin.ground }, voltageV: voltages.pullup })
    }
  }
  for (let i = circuit.length - 1; i >= 0; i--) if (circuit[i].type === 'simulation_voltage_source') circuit.splice(i, 1)
  const scope = circuit.find(r => r.type === 'pcb_board')?.subcircuit_id
  circuit.push({ type: 'simulation_experiment', simulation_experiment_id: id, name: block.name ?? id, experiment_type: 'spice_transient_analysis', spice_engine: 'pcb_spice', spice_options: { reltol: 1e-5, abstol: 1e-12, vntol: 1e-8 }, end_time_ms: duration * 1000, start_time_ms: 0, time_per_step: step * 1000, subcircuit_id: scope } as never)
  for (const pin of pins.values()) {
    const signal = driven.get(pin.port)
    const capabilities = pinCapabilities(pin)
    const output = !!signal || !capabilities.receive
    const enabled = signal ? !signal.driver_disabled : capabilities.drive && !capabilities.disable && !capabilities.receive
    if (!signal && enabled && topology.has(pin.port)) throw new Error(`Signal "${topology.get(pin.port)}" has two drivers: the listed driver and ${pin.port}. Exactly one pin drives a signal.`)
    circuit.push({ type: 'simulation_ibis_pin_state', simulation_ibis_pin_state_id: `${id}_${pin.port}`, simulation_experiment_id: id, source_port_id: pin.port, is_output: output, ...(output ? { is_output_enabled: enabled } : {}) } as never)
    if (!signal && enabled) circuit.push({ type: 'simulation_digital_stimulus', simulation_digital_stimulus_id: `${id}_${pin.port}_low`, name: pin.port, simulation_experiment_id: id, source_port_id: pin.port,
      bit_duration_ms: 1000 / rate, start_time_ms: 0, initial_state: 0, inverted: pin.buffer.polarity === 'inverting', transmission_pattern: { transmission_type: 'bits', bits: '0', repeat: true } } as never)
  }
  for (const signal of signals) {
    const bits = signalBits(signal, duration)
    if (signal.driver_disabled) continue
    for (const [index, port] of endpointPorts(signal.driver).entries()) {
      const pin = pins.get(port)!
      const inversion = Boolean(index) !== (pin.buffer.polarity === 'inverting')
      circuit.push({ type: 'simulation_digital_stimulus', simulation_digital_stimulus_id: `${id}_${signal.simulation_signal_id}_${index}`, name: signal.name, simulation_experiment_id: id, source_port_id: port, bit_duration_ms: 1000 / signal.bit_rate_bps, start_time_ms: signal.offset_s * 1000, initial_state: Number(bits[0]), inverted: inversion, transmission_pattern: { transmission_type: 'bits', bits, repeat: true } } as never)
    }
  }
  for (const signal of signals) for (const [index, endpoint] of [...signal.receivers, ...(isQuiet(signal) ? [signal.driver] : [])].entries()) {
    const ports = endpointPorts(endpoint)
    const ref = 'p_source_port_id' in endpoint ? ports[1] : pins.get(ports[0])!.ground
    circuit.push({ type: 'simulation_voltage_probe', simulation_voltage_probe_id: `${signal.simulation_signal_id}_${index}`, name: `${signal.name}_${index}`, signal_input_source_port_id: ports[0], reference_input_source_port_id: ref, subcircuit_id: scope } as never)
  }
  return { block, signals, circuit, pins, settings, warnings, duration, topology: new Map([...driven].map(([port, signal]) => [port, signalTopology(circuit, port, rails, new Set(endpointPorts(signal.driver).filter(other => other !== port)))])) }
}
