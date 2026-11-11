import { channelCopperScope, connectedSourceIds, type CopperScope } from '../../src/board'
import { endpointPorts, type PreparedBlock } from '../../src/pipeline/signals'

/** Reduce geometry admission only; retain every declared quiet driver and its vendor load. */
export function reducedCopperScope(block: PreparedBlock, names: readonly string[], distance: number): CopperScope {
  const selected = new Set(block.signals.filter(signal => names.includes(signal.name)).flatMap(signal => endpointPorts(signal.driver)).flatMap(port => [...connectedSourceIds(block.circuit, port)]))
  if (names.some(name => !block.signals.some(signal => signal.name === name))) throw new Error('Unknown reduced-scope signal')
  const rails = new Set([...block.pins.values()].flatMap(pin => [pin.power, pin.ground])
    .concat(block.circuit.filter(record => record.type === 'source_net').filter(net => net.is_ground || net.is_power).map(net => net.source_net_id))
    .flatMap(port => [...connectedSourceIds(block.circuit, port)]))
  const reference = connectedSourceIds(block.circuit, block.settings.channelReference!.sourcePortId!)
  const scope = channelCopperScope(block.circuit, selected, reference, rails, distance)
  if (block.settings.copperScope!.selectedPcbTraceIds.some(id => !scope.pcbTraceIds.includes(id))) throw new Error('Reduced geometry would omit a declared quiet channel')
  return scope
}

/** Remove package parasitics only; retain die buffers, C_comp and ideal die supplies. */
export function withoutPackage(deck: string): string {
  return deck.split('\n').flatMap(line => {
    if (/^[CKH]PKG/i.test(line)) return []
    if (/^[RL]PKG/i.test(line)) {
      const [name, from, to] = line.split(/\s+/)
      return [`RIDEAL${name} ${from} ${to} 1e-6`]
    }
    return [line]
  }).join('\n')
}

/** Ideal topology experiment at receiver balls; clock legs receive no single-ended VTT. */
export function receiverTermination(deck: string, probes: { name: string; signalNode: string }[], resistance: number): string {
  if (!(resistance > 0 && Number.isFinite(resistance))) throw new Error('Positive finite termination resistance required')
  const lines = ['* Ideal receiver-ball parallel termination, not routed components', 'VWHATIFVTT whatifvtt 0 0.75']
  for (const [index, probe] of probes.entries()) {
    if (!probe.name.endsWith('_0') || probe.name === 'CK_0' || probe.name === 'CKn_0') continue
    lines.push(`RWHATIFVTT${index} ${probe.signalNode} whatifvtt ${resistance}`)
  }
  if (!deck.includes('.control\n')) throw new Error('Missing native control block')
  return deck.replace('.control\n', lines.join('\n') + '\n.control\n')
}
