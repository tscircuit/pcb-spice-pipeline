import { connectedSourceIds, type CircuitJson } from '../board'

/** Copper reachable through two-terminal passives, excluding power and ground branches. */
export function signalTopology(circuit: CircuitJson, seed: string, rails: Set<string>): Set<string> {
  const found = connectedSourceIds(circuit, seed)
  const ports = circuit.filter(r => r.type === 'source_port')
  const passives = circuit.filter(r => r.type === 'source_component').filter(r => ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype))
  let changed = true
  while (changed) {
    changed = false
    for (const component of passives) {
      const pins = ports.filter(port => port.source_component_id === component.source_component_id).map(port => port.source_port_id)
      if (pins.length !== 2 || pins.some(pin => rails.has(pin)) || !pins.some(pin => found.has(pin))) continue
      for (const pin of pins) for (const id of connectedSourceIds(circuit, pin)) if (!found.has(id)) {
        found.add(id)
        changed = true
      }
    }
  }
  return found
}
