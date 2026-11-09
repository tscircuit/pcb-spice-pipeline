import React from 'react'
import { plannedSeed } from '../../src/pipeline/timing'
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
export async function renderSignals(tree: React.ReactElement, expectedErrors: string[] = []): Promise<CircuitJson> {
  const blocks: Record<string, unknown>[] = []
  const plating: (number | undefined)[] = []
  /** Expand local components, removing only the two unpublished intrinsic elements. */
  const strip = (element: React.ReactNode): React.ReactNode => {
    if (Array.isArray(element)) return element.map(strip)
    if (!React.isValidElement<Record<string, unknown>>(element)) return element
    if (typeof element.type === 'function') return strip((element.type as (props: unknown) => React.ReactNode)(element.props))
    if (element.type === 'board') {
      const imported = Array.isArray(element.props.circuitJson) ? element.props.circuitJson as CircuitJson : []
      const board = imported.find(record => record.type === 'pcb_board')
      const stack = imported.find(record => record.type === 'pcb_stackup' && record.pcb_board_id === (board?.type === 'pcb_board' ? board.pcb_board_id : undefined))
      plating.push(stack?.type === 'pcb_stackup' ? stack.plated_hole_copper_thickness : element.props.fabricatorPreset ? .018 : undefined)
    }
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
  // Match core#5286's imported-stackup precedence and JLC preset's declared 18 µm plating.
  records.filter(record => record.type === 'pcb_board').forEach((board, index) => {
    const stack = records.find(record => record.type === 'pcb_stackup' && record.pcb_board_id === board.pcb_board_id)
    if (stack?.type === 'pcb_stackup' && plating[index] !== undefined) stack.plated_hole_copper_thickness = plating[index]
  })
  const errors = records.filter(r => r.type.endsWith('_error') && !expectedErrors.includes(r.type))
  if (errors.length) throw new Error(JSON.stringify(errors))
  /** Resolve selector endpoints to exactly the RFC's source-port-id records. */
  const endpoint = (value: unknown): SignalEndpoint => {
    const wrapped = typeof value === 'object' && value && 'pin' in value ? value as { pin: unknown; model?: string | { p: string; n: string } } : { pin: value }
    /** Select a real rendered chip pin. */
    const port = (selector: string): string => {
      const [component, pin] = selector.split('>').map(s => s.trim().replace(/^\./, ''))
      return selectPort(records, { component, port: pin }).source_port_id
    }
    return typeof wrapped.pin === 'string'
      ? { kind: 'single', source_port_id: port(wrapped.pin), ...(typeof wrapped.model === 'string' ? { ibis_model_name: wrapped.model } : {}) }
      : { kind: 'differential', p_source_port_id: port((wrapped.pin as { p: string }).p), n_source_port_id: port((wrapped.pin as { n: string }).n), ...(wrapped.model ? { p_ibis_model_name: typeof wrapped.model === 'string' ? wrapped.model : wrapped.model.p, n_ibis_model_name: typeof wrapped.model === 'string' ? wrapped.model : wrapped.model.n } : {}) }
  }
  if (blocks.length > 1 && blocks.some(block => !block.name)) throw new Error(`This board has ${blocks.length} <signalintegrity> blocks; give each a name.`)
  const traffic = blocks.flatMap(block => (React.Children.toArray(block.children as React.ReactNode) as React.ReactElement<Record<string, unknown>>[]).map(child => ({ name: String(child.props.name), pattern: String(child.props.pattern ?? 'prbs7') })))
  let signalIndex = 0
  for (const [index, block] of blocks.entries()) {
    const id = `simulation_signal_integrity_${index}`
    const rate = valueWithUnits(block.bitRate)
    const children = React.Children.toArray(block.children as React.ReactNode) as React.ReactElement<Record<string, unknown>>[]
    const signals: SimulationSignal[] = children.map(child => {
      const p = child.props
      const name = String(p.name)
      const pattern = String(p.pattern ?? 'prbs7')
      const seed = /^prbs(7|15|31)$/.test(pattern) ? p.seed ?? plannedSeed(pattern, name, traffic) : undefined
      const signalRate = valueWithUnits(p.bitRate ?? rate)
      const rawMask = p.mask as { vih?: unknown; vil?: unknown; setup?: unknown; hold?: unknown } | undefined
      const mask: SimulationSignal['mask'] = rawMask && typeof rawMask === 'object' ? {
        ...(rawMask.vih !== undefined ? { vih_v: valueWithUnits(rawMask.vih) } : {}),
        ...(rawMask.vil !== undefined ? { vil_v: valueWithUnits(rawMask.vil) } : {}),
        ...(rawMask.setup !== undefined ? { setup_s: valueWithUnits(rawMask.setup) } : {}),
        ...(rawMask.hold !== undefined ? { hold_s: valueWithUnits(rawMask.hold) } : {}),
      } : 'ibis'
      return { type: 'simulation_signal', simulation_signal_id: `simulation_signal_${signalIndex++}`, simulation_signal_integrity_id: id, name,
        driver: endpoint(p.driver), receivers: (Array.isArray(p.receiver) ? p.receiver : [p.receiver]).map(endpoint), bit_rate_bps: signalRate,
        pattern, ...(seed !== undefined ? { seed: Number(seed) } : {}), offset_s: valueWithUnits(p.offset ?? 0, 1 / signalRate), ...(p.quiet !== undefined ? { quiet: p.quiet as SimulationSignal['quiet'] } : /^[0]+$/.test(pattern) ? { quiet: 'low' as const } : /^[1]+$/.test(pattern) ? { quiet: 'high' as const } : {}),
        probe: p.probe === 'global' ? 'global' : 'local', mask }
    })
    for (const [i, child] of children.entries()) if (child.props.strobe) {
      const strobe = signals.find(s => s.name === child.props.strobe)
      if (!strobe) throw new Error(`Signal "${signals[i].name}" strobe "${child.props.strobe}" is not a signal in block "${block.name ?? id}".`)
      signals[i].strobe_simulation_signal_id = strobe.simulation_signal_id
    }
    records.push({ type: 'simulation_signal_integrity', simulation_signal_integrity_id: id, ...(block.name !== undefined ? { name: String(block.name) } : {}), bit_rate_bps: rate,
      ...(block.duration !== undefined ? { duration_s: valueWithUnits(block.duration) } : {}), corner: (block.corner ?? 'typ') as 'typ' | 'min' | 'max', unlisted_nets: 'passive', unrouted: (block.unrouted ?? 'error') as 'error' | 'ideal', pdn: (block.pdn ?? 'ideal') as 'ideal' | 'extracted' }, ...signals)
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
