import { parseIbis, type IbisBuffer, type IbisComponent, type IbisDocument } from '@tscircuit/ibis-to-spice'
import type { CircuitJson, SimulationIbisModel } from '../board'
import type { IbisSources } from './types'
import { loadModelSource } from './source'

export interface InspectedPin {
  port: string; pin: string; model: SimulationIbisModel; component: IbisComponent; document: IbisDocument
  buffer: IbisBuffer; text: string; ground: string; power: string
}
/** Parse a numeric IBIS token, including vendor unit suffixes. */
export function ibisNumber(token: string): number {
  const match = /^([+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?)([TGMkmunpf]?)/.exec(token)
  if (!match) throw new Error(`Missing numeric IBIS value: ${token}`)
  const scales: Record<string, number> = { '': 1, T: 1e12, G: 1e9, M: 1e6, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
  return Number(match[1]) * scales[match[2]]
}
/** Resolve physical pins and reference rails; ambiguous mappings always fail. */
export function inspectPins(circuit: CircuitJson, sources: IbisSources): Map<string, InspectedPin> {
  const pins = new Map<string, InspectedPin>()
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    const { text } = loadModelSource({ ...model, pipelineId: model.simulation_ibis_model_id }, sources)
    const document = parseIbis(text)
    const component = document.components[model.ibis_component_name]
    if (!component) throw new Error(`IBIS component ${model.ibis_component_name} is missing`)
    const mapping = model.ibis_pin_name_to_source_port_id
    for (const [pin, port] of Object.entries(mapping)) {
      const physical = component.pins[pin]
      if (!physical) throw new Error(`${port}: physical IBIS pin ${pin} is missing`)
      if (/^(power|gnd|nc)$/i.test(physical.model)) continue
      const choices = document.selectors[physical.model] ?? [physical.model]
      const name = model.ibis_pin_name_to_model_name?.[pin] ?? (choices.length === 1 ? choices[0] : undefined)
      if (!name || !choices.includes(name)) throw new Error(`${port}: choose an IBIS model from ${choices.join(', ')}`)
      const refs = model.ibis_pin_name_to_reference_source_port_ids?.[pin]
      /** Resolve a vendor rail by [Pin Mapping], or a unique POWER/GND pin. */
      const rail = (role: 'ground' | 'power'): string => {
        const explicit = role === 'ground' ? refs?.pulldown_reference_source_port_id ?? refs?.ground_clamp_reference_source_port_id : refs?.pullup_reference_source_port_id ?? refs?.power_clamp_reference_source_port_id
        if (explicit) return explicit
        const named = role === 'ground' ? component.pinMapping[pin]?.pulldown : component.pinMapping[pin]?.pullup
        const candidates = Object.entries(component.pins).filter(([, p]) => named ? p.signal === named : p.model.toLowerCase() === (role === 'ground' ? 'gnd' : 'power')).map(([id]) => mapping[id]).filter(Boolean)
        if (candidates.length !== 1) throw new Error(`${port}: IBIS ${role} reference is ambiguous; provide the chip's reference mapping`)
        return candidates[0]
      }
      if (pins.has(port)) throw new Error(`${port}: more than one IBIS pin binding`)
      pins.set(port, { port, pin, model, component, document, buffer: document.getBuffer(name), text, ground: rail('ground'), power: rail('power') })
    }
  }
  return pins
}
/** Exact [Model] body, retaining [Receiver Thresholds] and [Ramp] subsections. */
export function modelText(pin: InspectedPin): string {
  const sections = pin.text.split(/^\s*\[Model\]\s+/gmi).slice(1)
  const section = sections.find(s => s.split(/\s/)[0].toLowerCase() === pin.buffer.name.toLowerCase())
  if (!section) throw new Error(`IBIS model body ${pin.buffer.name} missing`)
  return section
}
/** Fastest measured 10–90% output edge at the chosen corner, or the [Ramp] dV/dt. */
export function edgeSeconds(pin: InspectedPin, corner: number): number {
  const edges: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const data = waveform.data.filter(row => row[corner + 1] !== null).map(row => [row[0], row[corner + 1]!] as const)
    if (data.length < 2) continue
    const first = data[0][1]
    const last = data.at(-1)![1]
    if (Math.abs(last - first) < 1e-6) continue
    /** First interpolated crossing of a fraction of the measured edge. */
    const crossing = (fraction: number): number | undefined => {
      const target = first + (last - first) * fraction
      for (let i = 1; i < data.length; i++) {
        const a = data[i - 1]
        const b = data[i]
        if ((a[1] - target) * (b[1] - target) <= 0 && a[1] !== b[1]) return a[0] + (target - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
      }
      return undefined
    }
    const a = crossing(.1)
    const b = crossing(.9)
    if (a !== undefined && b !== undefined && b > a) edges.push(b - a)
  }
  if (!edges.length) {
    for (const line of modelText(pin).split(/\r?\n/).filter(line => /^\s*dV\/dt_[rf]/i.test(line))) {
      const token = line.trim().split(/\s+/)[corner + 1]
      if (!token || token === 'NA') continue
      const [dv, dt] = token.split('/')
      const edge = ibisNumber(dt) * .8 * pin.buffer.voltage[corner]! / ibisNumber(dv)
      if (edge > 0 && Number.isFinite(edge)) edges.push(edge)
    }
  }
  if (!edges.length) throw new Error(`${pin.port}: IBIS edge rate missing at selected corner`)
  return Math.min(...edges)
}
/** Selected model capabilities; unsupported types cannot acquire invented receive/disable modes. */
export function pinCapabilities(pin: InspectedPin): { drive: boolean; receive: boolean; disable: boolean } {
  switch (pin.buffer.type) {
    case 'input': return { drive: false, receive: true, disable: false }
    case 'output': return { drive: true, receive: false, disable: false }
    case 'i/o': return { drive: true, receive: true, disable: true }
    case '3-state': return { drive: true, receive: false, disable: true }
    case 'terminator': return { drive: false, receive: true, disable: false }
    default: throw new Error(`${pin.port}: unsupported IBIS model capability ${pin.buffer.type}`)
  }
}
/** DC thresholds at the test corner, with the IBIS receiver reference-supply correction. */
export function receiverThresholds(pin: InspectedPin, differential: boolean, mask: 'ibis' | { vih_v?: number; vil_v?: number }, corner: number): { vih: number; vil: number } {
  const overrides = mask === 'ibis' ? {} : mask
  const text = modelText(pin)
  /** Exact subsection; model-level scalars stop at its first keyword. */
  const section = (name: string): string => {
    if (name === 'Model') return text.split(/^\s*\[/m)[0]
    const match = new RegExp(`^\\s*\\[${name}\\]`, 'mi').exec(text)
    return match ? text.slice(match.index + match[0].length).split(/^\s*\[/m)[0] : ''
  }
  /** Tokens for one scalar or three-corner keyword. */
  const tokens = (body: string, name: string): string[] | undefined => body.split(/\r?\n/).find(line => new RegExp(`^\\s*${name}(?:\\s|=)`, 'i').test(line))?.replace(/\|.*$/, '').trim().split(/[\s=]+/).slice(1)
  /** Select the corner; only Model Spec NA falls back to the required typical value. */
  const numeric = (values: string[] | undefined, selected: number = corner, fallback: boolean = false): number | undefined => {
    if (!values?.length || /^NA$/i.test(values[0])) return undefined
    let token = values.length >= 3 ? values[selected] : values[0]
    if (/^NA$/i.test(token) && fallback) token = values[0]
    return token && !/^NA$/i.test(token) ? ibisNumber(token) : undefined
  }
  const receiver = section('Receiver Thresholds')
  /** Receiver threshold scalar or corner-valued field. */
  const threshold = (name: string): number | undefined => numeric(tokens(receiver, name))
  let high: number | undefined
  let low: number | undefined
  if (differential) {
    const pair = pin.component.differentialPins.find(pair => pair.pin === pin.pin)
    const value = threshold('Vdiff_dc') ?? pair?.voltage ?? undefined
    high = value
    low = value === undefined ? undefined : -value
  } else {
    const spec = section('Model Spec')
    /** Model Spec overrides Model even when the required typical value is missing. */
    const dc = (name: string): number | undefined => {
      const declared = tokens(spec, name)
      return declared ? numeric(declared, corner, true) : numeric(tokens(section('Model'), name))
    }
    high = dc('Vinh')
    low = dc('Vinl')
    const vth = threshold('Vth')
    const highOffset = threshold('Vinh_dc')
    const lowOffset = threshold('Vinl_dc')
    const sensitivity = threshold('Threshold_sensitivity')
    const reference = tokens(receiver, 'Reference_supply')?.[0]?.toLowerCase()
    let correction: number | undefined = corner === 0 ? 0 : undefined
    if (sensitivity !== undefined && !reference) correction = undefined
    if (corner !== 0 && sensitivity !== undefined && reference) {
      const references: Record<string, { name: string; default?: number[] }> = {
        pullup_ref: { name: 'Pullup Reference', default: pin.buffer.voltage as number[] },
        power_clamp_ref: { name: 'POWER Clamp Reference', default: pin.buffer.voltage as number[] },
        pulldown_ref: { name: 'Pulldown Reference', default: [0, 0, 0] },
        gnd_clamp_ref: { name: 'GND Clamp Reference', default: [0, 0, 0] },
        ext_ref: { name: 'External Reference' },
      }
      const field = references[reference]
      if (field) {
        const declared = new RegExp(`^\\s*\\[${field.name}\\]([^\\r\\n]*)`, 'mi').exec(text)?.[1].trim().split(/\s+/)
        const typical = declared ? numeric(declared, 0) : field.default?.[0]
        const selected = declared ? numeric(declared, corner) : field.default?.[corner]
        if (typical != null && selected != null) correction = sensitivity * (selected - typical)
      }
    }
    if (vth !== undefined && highOffset !== undefined && lowOffset !== undefined && correction !== undefined) {
      high = (threshold('Vth_max') ?? vth) + correction + highOffset
      low = (threshold('Vth_min') ?? vth) + correction + lowOffset
    }
  }
  const vih = overrides.vih_v ?? high
  const vil = overrides.vil_v ?? low
  if (vih === undefined || vil === undefined || !Number.isFinite(vih) || !Number.isFinite(vil) || vih <= vil) throw new Error(`${pin.port} has no usable ${differential ? 'differential' : 'DC'} thresholds at ${['typ', 'min', 'max'][corner]}; specify mask.vih and mask.vil.`)
  return { vih, vil }
}
