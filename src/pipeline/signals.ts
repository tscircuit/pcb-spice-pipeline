import { connectedSourceIds, stackupFromCircuitJson, type CircuitJson, type SignalEndpoint, type SimulationSignal, type SimulationSignalIntegrity } from '../board'
import { inspectPins, edgeSeconds, type InspectedPin, type IbisSources } from '../buffers'
import { safeId } from '../kernel'
import type { NumericalSettings } from './modeling'
import { signalTopology, validateSignalGraph } from './topology'
import { compareNames, recordingTime } from './timing'
import { pinCapabilities } from '../buffers'

export interface PreparedBlock {
  duration: number; topology: Map<string, Set<string>>;
  block: SimulationSignalIntegrity; signals: SimulationSignal[]; circuit: CircuitJson
  pins: Map<string, InspectedPin>; settings: NumericalSettings
}
/** Ordered physical ports: the sign of a differential signal is P minus N. */
export function endpointPorts(endpoint: SignalEndpoint): string[] {
  return endpoint.kind === 'single' ? [endpoint.source_port_id] : [endpoint.p_source_port_id, endpoint.n_source_port_id]
}
/** Seeded PRBS generation bounded by the actual requested recording; never allocate a full PRBS31 period. */
export function signalBits(signal: SimulationSignal, duration: number): string {
  const order = /^prbs(7|15|31)$/.exec(signal.pattern)
  const width = Number(order?.[1])
  const mask = 2 ** width - 1
  if (order && (!Number.isInteger(signal.seed) || signal.seed! < 1 || signal.seed! > mask)) throw new Error(`Signal "${signal.name}": ${signal.pattern} seed must be an integer in 1..${mask}.`)
  if (signal.quiet) return signal.quiet === 'high' ? '1' : '0'
  if (signal.pattern === 'clock') return '01'
  if (!order) {
    if (!/^[01]+$/.test(signal.pattern)) throw new Error(`${signal.name}: pattern must be PRBS, clock, or a literal bit string`)
    return signal.pattern
  }
  let state = signal.seed!
  const count = Math.min(mask, Math.ceil(duration * signal.bit_rate_bps) + 1)
  const tap = width === 7 ? 6 : width === 15 ? 14 : 28
  let bits = ''
  for (let i = 0; i < count; i++) {
    bits += String((state >>> (width - 1)) & 1)
    state = ((state << 1) | (((state >>> (width - 1)) ^ (state >>> (tap - 1))) & 1)) & mask
  }
  return bits
}
/** Validate blocks and lower test intent to the private native-solver declarations. */
export function prepareBlocks(circuitJson: CircuitJson, sources: IbisSources): PreparedBlock[] {
  const blocks = circuitJson.filter(r => r.type === 'simulation_signal_integrity')
  if (blocks.length > 1 && blocks.some(block => !block.name)) throw new Error(`This board has ${blocks.length} <simulation.pcbtransientchannelsimulation> blocks; give each a name.`)
  const ids = new Set(blocks.map(b => b.simulation_signal_integrity_id))
  if (ids.size !== blocks.length) throw new Error('Duplicate simulation_signal_integrity identifier')
  for (const signal of circuitJson.filter(r => r.type === 'simulation_signal')) if (!ids.has(signal.simulation_signal_integrity_id)) throw new Error(`${signal.name}: unknown signal-integrity block`)
  return blocks.map(block => prepareBlock(circuitJson, block, sources))
}
/** Independent block: model overrides, copper, pin states, references and stimuli. */
function prepareBlock(input: CircuitJson, block: SimulationSignalIntegrity, sources: IbisSources): PreparedBlock {
  const id = safeId(block.simulation_signal_integrity_id, 'simulationSignalIntegrityId')
  const signals = input.filter(r => r.type === 'simulation_signal').filter(r => r.simulation_signal_integrity_id === id).sort((a, b) => compareNames(a.name, b.name))
  if (!signals.length || new Set(signals.map(s => s.name)).size !== signals.length || new Set(signals.map(s => s.simulation_signal_id)).size !== signals.length) throw new Error(`${block.name ?? id}: require distinct named signals`)
  const timing = recordingTime(signals)
  const duration = block.duration_s ?? timing.duration
  const circuit = structuredClone(input.filter(r => !r.type.startsWith('simulation_') || ['simulation_ibis_model', 'simulation_voltage_source', 'simulation_spice_subcircuit'].includes(r.type)))
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    model.model_value_corner = block.corner
    model.include_package_parasitics = true
    for (const signal of signals) for (const endpoint of [signal.driver, ...signal.receivers]) {
      for (const [index, port] of endpointPorts(endpoint).entries()) {
        const selected = endpoint.kind === 'single' ? endpoint.ibis_model_name : index === 0 ? endpoint.p_ibis_model_name : endpoint.n_ibis_model_name
        if (!selected) continue
        for (const [pin, target] of Object.entries(model.ibis_pin_name_to_source_port_id)) if (target === port) {
          model.ibis_pin_name_to_model_name = { ...model.ibis_pin_name_to_model_name, [pin]: selected }
        }
      }
    }
  }
  const pins = inspectPins(circuit, sources)
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    const component = [...pins.values()].find(pin => pin.model === model)?.component
    const chip = circuit.filter(r => r.type === 'source_component').find(r => r.source_component_id === model.source_component_id)
    if (component?.coupledPackage) throw new Error(`.${chip?.name ?? model.ibis_component_name}: coupled [Package Model] not implemented yet; scalar fallback is forbidden.`)
  }
  const rails = new Set([...pins.values()].flatMap(pin => [pin.ground, pin.power]).flatMap(port => [...connectedSourceIds(circuit, port)]))
  for (const pin of pins.values()) {
    const model = pin.model
    model.ibis_pin_name_to_reference_source_port_ids ??= {}
    model.ibis_pin_name_to_reference_source_port_ids[pin.pin] ??= { pullup_reference_source_port_id: pin.power, power_clamp_reference_source_port_id: pin.power, pulldown_reference_source_port_id: pin.ground, ground_clamp_reference_source_port_id: pin.ground }
  }
  const driven = new Map<string, SimulationSignal>()
  const topology = new Map<string, string>()
  const corner = { typical: 0, minimum: 1, maximum: 2 }[block.corner]
  const edges: number[] = []
  for (const signal of signals) {
    safeId(signal.simulation_signal_id, 'simulationSignalId')
    if (signal.quiet !== undefined && !['low', 'high', 'off'].includes(signal.quiet)) throw new Error('quiet needs a level: "low", "high" or "off".')
    const drivers = endpointPorts(signal.driver)
    for (const port of drivers) {
      const pin = pins.get(port)
      if (!pin) throw new Error(`Signal "${signal.name}" driver ${port} has no <simulation.ibismodel>.`)
      const capabilities = pinCapabilities(pin)
      if (!capabilities.drive) throw new Error(`${port}: selected model does not support driving on this pin.`)
      if (signal.quiet === 'off' && !capabilities.disable) throw new Error(`Signal "${signal.name}": ${port} model ${pin.buffer.name} has no disabled state; use quiet="low" or "high".`)
      driven.set(port, signal)
      edges.push(edgeSeconds(pin, corner))
      for (const net of signalTopology(circuit, port, rails)) {
        const owner = topology.get(net)
        if (owner && owner !== signal.name) throw new Error(`Signals "${owner}" and "${signal.name}" are on the same net; one signal per net.`)
        topology.set(net, signal.name)
      }
    }
    for (const receiver of signal.receivers) {
      if (receiver.kind !== signal.driver.kind) throw new Error(`${signal.name}: driver and receiver must use the same endpoint kind`)
      for (const [index, port] of endpointPorts(receiver).entries()) {
        if (!pins.has(port)) throw new Error(`Signal "${signal.name}" receiver ${port} has no <simulation.ibismodel>.`)
        if (!pinCapabilities(pins.get(port)!).receive) throw new Error(`${port}: selected model does not support receiving on this pin.`)
        if (!signalTopology(circuit, drivers[index], rails).has(port)) throw new Error(`Receiver ${port} is not connected to the copper of signal "${signal.name}".`)
      }
    }
    if (signal.driver.kind === 'differential') for (const endpoint of [signal.driver, ...signal.receivers]) {
      const [p, n] = endpointPorts(endpoint).map(port => pins.get(port)!)
      const pair = p.component.differentialPins.find(pair => pair.pin === p.pin && pair.invertedPin === n.pin)
      if (p.model.source_component_id !== n.model.source_component_id) throw new Error(`Signal "${signal.name}": both differential legs must belong to the same chip.`)
      if (!pair) throw new Error(`Signal "${signal.name}": differential pin order disagrees with IBIS [Diff_pin]; swap p and n or repair the model mapping.`)
      // The vendor's model Polarity is already applied by the converter.
    }
  }
  validateSignalGraph(circuit, signals, rails, block.unrouted)
  const edge = Math.min(...edges)
  const rate = Math.max(...signals.map(s => s.bit_rate_bps))
  const step = Math.min(1 / rate / 100, edge / 20)
  const reference = pins.get([...driven.keys()].sort()[0])!.ground
  const lanes: NumericalSettings['lanes'] = []
  if (block.pdn === 'extracted') throw new Error('pdn="extracted" is not implemented yet; omit pdn to use the default pdn="ideal"')
  for (const port of circuit.filter(r => r.type === 'source_port').filter(port => topology.has(port.source_port_id) && !pins.has(port.source_port_id))) {
    const component = circuit.filter(r => r.type === 'source_component').find(component => component.source_component_id === port.source_component_id)
    if (!component || (!['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(component.ftype) && !circuit.some(r => r.type === 'simulation_spice_subcircuit' && r.source_component_id === component.source_component_id))) throw new Error(`${component?.name ?? port.source_port_id} is on the signal and has no supported SPICE or IBIS model.`)
  }
  for (const trace of circuit.filter(r => r.type === 'source_trace').sort((a, b) => a.source_trace_id.localeCompare(b.source_trace_id))) {
    const ports = trace.connected_source_port_ids
    const pcb = circuit.filter(r => r.type === 'pcb_trace' && r.source_trace_id === trace.source_trace_id)
    if (!pcb.length || !ports.length || ports.some(port => rails.has(port))) continue
    if (ports.length !== 2 || pcb.length !== 1) throw new Error(`Signal "${topology.get(ports[0]) ?? trace.source_trace_id}": branched routed graphs are not implemented yet.`)
    const ordered = [...ports].sort()
    if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
    lanes.push({ port: topology.get(ordered[0]) ? `${topology.get(ordered[0])}_${trace.source_trace_id}` : `passive_${trace.source_trace_id}`, from: { sourcePortId: ordered[0] }, to: { sourcePortId: ordered[1] }, sourceTraceId: trace.source_trace_id })
  }
  for (const signal of signals) for (const port of endpointPorts(signal.driver)) if (!lanes.some(l => l.from.sourcePortId === port || l.to.sourcePortId === port)) {
    if (block.unrouted === 'error') throw new Error(`Signal "${signal.name}" is not routed from ${port}.`)
  }
  if (!lanes.length && block.unrouted !== 'ideal') throw new Error('At least one routed conductor is required for native extraction')
  // Stable physical endpoint identities order the matrix; route coordinates set coupling.
  lanes.sort((a, b) => a.from.sourcePortId!.localeCompare(b.from.sourcePortId!))
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
    measurementGate: Math.min(timing.gate, duration / 2), reduction: 'routed-copper', allowIdeal: block.unrouted === 'ideal', simplifyParallel: true, sections: Math.max(2, Math.ceil(length / 1000 * Math.sqrt(stack.relativePermittivity) / 299792458 / edge * 10)),
    lanes, channelReference: { sourcePortId: reference }, groundReturn: { sourcePortId: groundCandidates[0] },
    relativePermittivity: stack.relativePermittivity,
    extraction: { minimumHz: modelHz / 10 ** decade, modelHz, maximumHz: modelHz, filaments, refinementFilaments: filaments + 4,
      convergenceTolerance: .05, capTolerance: .02, reciprocityTolerance: .025, dcResistanceTolerance: .002,
      maxPanelLengthMm: mesh * 2, groundMeshMm: mesh },
    passiveComponents: circuit.filter(r => r.type === 'source_component').filter(r => (['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype) || circuit.some(model => model.type === 'simulation_spice_subcircuit' && model.source_component_id === r.source_component_id))).map(r => ({ sourceComponentId: r.source_component_id })),
  }
  if (circuit.some(r => r.type === 'pcb_via')) {
    if (!stack.viaPlatingMm) throw new Error('pcb_stackup must specify plated_hole_copper_thickness for routed vias')
    settings.viaPlatingMm = stack.viaPlatingMm
    settings.viaEquivalentWidthMm = Math.min(...circuit.filter(r => r.type === 'pcb_via').map(v => v.hole_diameter + 2 * stack.viaPlatingMm!))
    settings.omitThroughViaStubs = true
  }
  const values = new Map<string, number>()
  for (const pin of pins.values()) {
    const voltage = pin.buffer.voltage[corner]
    if (voltage === null) throw new Error(`${pin.port}: [Voltage Range] missing at corner ${block.corner}`)
    const net = [...connectedSourceIds(circuit, pin.power)].sort().join(',')
    if (values.has(net) && Math.abs(values.get(net)! - voltage) > 1e-8) throw new Error(`${pin.port}: shared reference VCC has incompatible IBIS corner voltages.`)
    if (!values.has(net)) {
      values.set(net, voltage)
      settings.supplies ??= []
      settings.supplies.push({ positive: { sourcePortId: pin.power }, negative: { sourcePortId: pin.ground }, voltageV: voltage })
    }
  }
  for (let i = circuit.length - 1; i >= 0; i--) if (circuit[i].type === 'simulation_voltage_source') circuit.splice(i, 1)
  const scope = circuit.find(r => r.type === 'pcb_board')?.subcircuit_id
  circuit.push({ type: 'simulation_experiment', simulation_experiment_id: id, name: block.name ?? id, experiment_type: 'spice_transient_analysis', spice_engine: 'pcb_spice', spice_options: { reltol: 1e-5, abstol: 1e-12, vntol: 1e-8 }, end_time_ms: duration * 1000, start_time_ms: 0, time_per_step: step * 1000, subcircuit_id: scope } as never)
  for (const pin of pins.values()) {
    const signal = driven.get(pin.port)
    const capabilities = pinCapabilities(pin)
    const output = !!signal || !capabilities.receive
    const enabled = signal ? signal.quiet !== 'off' : capabilities.drive && !capabilities.disable && !capabilities.receive
    if (!signal && enabled && topology.has(pin.port)) throw new Error(`Signal "${topology.get(pin.port)}" has two drivers: the listed driver and ${pin.port}. Exactly one pin drives a signal.`)
    circuit.push({ type: 'simulation_ibis_pin_state', simulation_ibis_pin_state_id: `${id}_${pin.port}`, simulation_experiment_id: id, source_port_id: pin.port, is_output: output, ...(output ? { is_output_enabled: enabled } : {}) } as never)
    if (!signal && enabled) circuit.push({ type: 'simulation_digital_stimulus', simulation_digital_stimulus_id: `${id}_${pin.port}_low`, name: pin.port, simulation_experiment_id: id, source_port_id: pin.port,
      bit_duration_ms: 1000 / rate, start_time_ms: 0, initial_state: 0, inverted: pin.buffer.polarity === 'inverting', transmission_pattern: { transmission_type: 'bits', bits: '0', repeat: true } } as never)
  }
  for (const signal of signals) {
    const bits = signalBits(signal, duration)
    if (signal.quiet === 'off') continue
    for (const [index, port] of endpointPorts(signal.driver).entries()) {
      const pin = pins.get(port)!
      const inversion = Boolean(index) !== (pin.buffer.polarity === 'inverting')
      circuit.push({ type: 'simulation_digital_stimulus', simulation_digital_stimulus_id: `${id}_${signal.simulation_signal_id}_${index}`, name: signal.name, simulation_experiment_id: id, source_port_id: port, bit_duration_ms: 1000 / signal.bit_rate_bps, start_time_ms: signal.offset_s * 1000, initial_state: Number(bits[0]), inverted: inversion, transmission_pattern: { transmission_type: 'bits', bits, repeat: true } } as never)
    }
  }
  for (const signal of signals) for (const [index, endpoint] of [...signal.receivers, ...(signal.quiet ? [signal.driver] : [])].entries()) {
    const ports = endpointPorts(endpoint)
    const ref = endpoint.kind === 'differential' ? ports[1] : signal.probe === 'global' ? reference : pins.get(ports[0])!.ground
    circuit.push({ type: 'simulation_voltage_probe', simulation_voltage_probe_id: `${signal.simulation_signal_id}_${index}`, name: `${signal.name}_${index}`, signal_input_source_port_id: ports[0], reference_input_source_port_id: ref, subcircuit_id: scope } as never)
  }
  return { block, signals, circuit, pins, settings, duration, topology: new Map([...driven].map(([port, signal]) => [port, signalTopology(circuit, port, rails, new Set(endpointPorts(signal.driver).filter(other => other !== port)))])) }
}
