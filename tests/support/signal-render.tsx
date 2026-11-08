import React from 'react'
import { Circuit } from '@tscircuit/core'
import { selectPort, type CircuitJson, type SignalEndpoint, type SimulationSignal } from '../../src/board'

/** Temporary rendering adapter until the parallel core/props PRs publish the two intrinsics. */
export async function renderSignals(tree: React.ReactElement): Promise<CircuitJson> {
  const blocks: Record<string, unknown>[] = []
  /** Expand local components, removing only the two unpublished intrinsic elements. */
  const strip = (element: React.ReactNode): React.ReactNode => {
    if (Array.isArray(element)) return element.map(strip)
    if (!React.isValidElement<Record<string, unknown>>(element)) return element
    if (typeof element.type === 'function') return strip((element.type as (props: unknown) => React.ReactNode)(element.props))
    if (element.type === 'signalintegrity') {
      blocks.push(element.props)
      return null
    }
    if (element.type === 'ibismodel') return React.cloneElement(element, { modelValueCorner: 'typical', includePackageParasitics: true })
    if (element.props.children === undefined) return element
    return React.cloneElement(element, {}, React.Children.map(element.props.children as React.ReactNode, strip))
  }
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(strip(tree) as React.ReactElement)
  await circuit.renderUntilSettled()
  const records: CircuitJson = circuit.getCircuitJson()
  const errors = records.filter(r => r.type.endsWith('_error'))
  if (errors.length) throw new Error(JSON.stringify(errors))
  /** Resolve selector endpoints to exactly the RFC's source-port-id records. */
  const endpoint = (value: unknown): SignalEndpoint => {
    const wrapped = typeof value === 'object' && value && 'pin' in value ? value as { pin: unknown; model?: string } : { pin: value }
    /** Select a real rendered chip pin. */
    const port = (selector: string): string => {
      const [component, pin] = selector.split('>').map(s => s.trim().replace(/^\./, ''))
      return selectPort(records, { component, port: pin }).source_port_id
    }
    return typeof wrapped.pin === 'string'
      ? { kind: 'single', source_port_id: port(wrapped.pin), ...(wrapped.model ? { ibis_model_name: wrapped.model } : {}) }
      : { kind: 'differential', p_source_port_id: port((wrapped.pin as { p: string }).p), n_source_port_id: port((wrapped.pin as { n: string }).n), ...(wrapped.model ? { ibis_model_name: wrapped.model } : {}) }
  }
  for (const [index, block] of blocks.entries()) {
    const id = `si_${index}`
    const rate = Number(block.bitRate)
    const children = React.Children.toArray(block.children as React.ReactNode) as React.ReactElement<Record<string, unknown>>[]
    const signals: SimulationSignal[] = children.map((child, i) => {
      const p = child.props
      const name = String(p.name)
      let seed = 1
      for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
      return { type: 'simulation_signal', simulation_signal_id: `${id}_signal_${i}`, simulation_signal_integrity_id: id, name,
        driver: endpoint(p.driver), receivers: (Array.isArray(p.receiver) ? p.receiver : [p.receiver]).map(endpoint), bit_rate_bps: Number(p.bitRate ?? rate),
        pattern: String(p.pattern ?? 'prbs7'), seed: Number(p.seed ?? ((seed & 127) || 1)), offset_s: Number(p.offset ?? 0), quiet: p.quiet as SimulationSignal['quiet'],
        probe: p.probe === 'global' ? 'global' : 'local', mask: (p.mask ?? 'ibis') as SimulationSignal['mask'] }
    })
    for (const [i, child] of children.entries()) if (child.props.strobe) signals[i].strobe_simulation_signal_id = signals.find(s => s.name === child.props.strobe)?.simulation_signal_id
    records.push({ type: 'simulation_signal_integrity', simulation_signal_integrity_id: id, name: String(block.name ?? 'SI'), bit_rate_bps: rate,
      duration_s: Number(block.duration ?? 143 / rate), corner: 'typ', unlisted_nets: 'passive', unrouted: 'error', pdn: (block.pdn ?? 'ideal') as 'ideal' | 'extracted', supply: 'board' }, ...signals)
  }
  return records
}
