import React from 'react'
import { Circuit } from '@tscircuit/core'
import { selectPort, type CircuitJson, type SignalEndpoint, type SimulationSignal } from '../../src/board'

/** RFC units used by this temporary TSX renderer bridge. */
function valueWithUnits(value: unknown, ui: number = 1): number {
  if (typeof value === 'number') return value
  const match = /^([+\-\d.eE]+)\s*(UI|[fpnumkMG]?(?:s|bps|V))$/.exec(String(value))
  if (!match) throw new Error(`Unsupported RFC unit value ${String(value)}`)
  if (match[2] === 'UI') return Number(match[1]) * ui
  const suffix = match[2].replace(/(?:s|bps|V)$/, '')
  const scales: Record<string, number> = { '': 1, f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 }
  return Number(match[1]) * scales[suffix]
}

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
  for (const record of records.filter(r => r.type === 'simulation_ibis_model')) {
    Reflect.deleteProperty(record, 'model_value_corner')
    Reflect.deleteProperty(record, 'include_package_parasitics')
  }
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
    const rate = valueWithUnits(block.bitRate)
    const children = React.Children.toArray(block.children as React.ReactNode) as React.ReactElement<Record<string, unknown>>[]
    const signals: SimulationSignal[] = children.map((child, i) => {
      const p = child.props
      const name = String(p.name)
      let seed = 1
      for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
      const signalRate = valueWithUnits(p.bitRate ?? rate)
      const rawMask = p.mask as { vih?: unknown; vil?: unknown; setup?: unknown; hold?: unknown } | undefined
      const mask: SimulationSignal['mask'] = rawMask && typeof rawMask === 'object' ? {
        ...(rawMask.vih !== undefined ? { vih_v: valueWithUnits(rawMask.vih) } : {}),
        ...(rawMask.vil !== undefined ? { vil_v: valueWithUnits(rawMask.vil) } : {}),
        ...(rawMask.setup !== undefined ? { setup_s: valueWithUnits(rawMask.setup) } : {}),
        ...(rawMask.hold !== undefined ? { hold_s: valueWithUnits(rawMask.hold) } : {}),
      } : 'ibis'
      return { type: 'simulation_signal', simulation_signal_id: `${id}_signal_${i}`, simulation_signal_integrity_id: id, name,
        driver: endpoint(p.driver), receivers: (Array.isArray(p.receiver) ? p.receiver : [p.receiver]).map(endpoint), bit_rate_bps: signalRate,
        pattern: String(p.pattern ?? 'prbs7'), seed: Number(p.seed ?? ((seed & 127) || 1)), offset_s: valueWithUnits(p.offset ?? 0, 1 / signalRate), quiet: p.quiet as SimulationSignal['quiet'],
        probe: p.probe === 'global' ? 'global' : 'local', mask }
    })
    for (const [i, child] of children.entries()) if (child.props.strobe) signals[i].strobe_simulation_signal_id = signals.find(s => s.name === child.props.strobe)?.simulation_signal_id
    const defaultDuration = Math.max(...signals.map(signal => {
      const width = /^prbs(7|15|31)$/.exec(signal.pattern)
      const period = width ? 2 ** Number(width[1]) - 1 : signal.pattern === 'clock' ? 2 : signal.pattern.length
      return signal.offset_s + (16 + period) / signal.bit_rate_bps
    }))
    records.push({ type: 'simulation_signal_integrity', simulation_signal_integrity_id: id, name: String(block.name ?? 'SI'), bit_rate_bps: rate,
      duration_s: valueWithUnits(block.duration ?? defaultDuration), corner: (block.corner ?? 'typ') as 'typ' | 'min' | 'max', unlisted_nets: 'passive', unrouted: (block.unrouted ?? 'error') as 'error' | 'ideal', pdn: (block.pdn ?? 'extracted') as 'ideal' | 'extracted', supply: (block.supply ?? 'board') as 'board' | 'ibis' }, ...signals)
  }
  return records
}

// Local declarations bridge unpublished intrinsic props during this repository's TSX tests.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      signalintegrity: Record<string, unknown>
      signal: Record<string, unknown>
    }
  }
}
