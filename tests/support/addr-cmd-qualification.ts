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
