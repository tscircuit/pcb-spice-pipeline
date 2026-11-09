import { convertIbisModelToSpice, parseIbis, type ConvertedGeneralIbisComponent } from '@tscircuit/ibis-to-spice'
import type { ModelRunDefinition } from './types'

/** Convert die buffers, retaining vendor signal-pin packages under the supported ideal PDN. */
export function convertPackaged(bytes: Uint8Array, input: ModelRunDefinition): ConvertedGeneralIbisComponent {
  const document = parseIbis(new TextDecoder().decode(bytes))
  const component = document.components[input.definition.component]
  if (!component) throw new Error(`Missing IBIS component ${input.definition.component}`)
  if (component.coupledPackage) throw new Error(`${component.name}: coupled [Package Model] not implemented yet; scalar fallback is forbidden`)
  const converted = convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, input.run)
  const corner = { typical: 0, minimum: 1, maximum: 2 }[input.definition.corner]
  const top = converted.source.indexOf('\n.ends ')
  const wrapper = converted.source.slice(0, top).split('\n')
  const header = wrapper.findIndex(line => /^\.subckt /i.test(line))
  const nodes = new Map<string, string>()
  const elements: string[] = []
  const refs = converted.metadata.pins.map(pin => pin.references.pulldown)
  const ground = [...new Set(refs)]
  if (ground.length !== 1) throw new Error(`${component.name}: per-bank package ground requires an explicit package model`)
  const groundTerminal = Object.entries(converted.spicePinMapping).find(([, port]) => port === ground[0])?.[0]
  if (!groundTerminal) throw new Error(`${component.name}: package ground is not mapped`)
  // pdn="ideal" promises perfect die rails. Non-power-aware IBIS assumes ideal die
  // voltages: without Composite Current/ISSO/split C_comp data or on-die decoupling,
  // feeding die rails through bare package inductance is unphysical. Keep signal RLC.
  for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
    const physical = Object.entries(input.definition.pinMap).filter(([, value]) => value === port)
    if (physical.length !== 1) throw new Error(`${port}: package pin mapping is ambiguous`)
    const pin = component.pins[physical[0][0]]
    if (/^(power|gnd)$/i.test(pin.model)) continue
    let node = terminal
    for (const [field, kind] of [['resistance', 'R'], ['inductance', 'L']] as const) {
      const value = pin[field] ?? component.package[field]?.[corner]
      if (value === undefined || value === null || value < 0) throw new Error(`${physical[0][0]}: vendor package ${field} missing`)
      if (value > 0) {
        const next = `PKG${kind}${i}`
        elements.push(`${kind}PKG${i} ${node} ${next} ${value}`)
        node = next
      }
    }
    nodes.set(terminal, node)
    const value = pin.capacitance ?? component.package.capacitance?.[corner]
    if (value === undefined || value === null || value < 0) throw new Error(`${physical[0][0]}: vendor package capacitance missing`)
    if (value > 0) {
      elements.push(`CPKG${i}a ${terminal} ${groundTerminal} ${value / 2}`, `CPKG${i}b ${node} ${groundTerminal} ${value / 2}`)
    }
  }
  const body = wrapper.map((line, index) => index <= header ? line : line.replace(/\S+/g, token => nodes.get(token) ?? token))
  converted.source = [...body, ...elements].join('\n') + converted.source.slice(top)
  converted.metadata.packagePolicy = 'vendor'
  converted.metadata.omissions = ['POWER/GND package R/L/C omitted under pdn="ideal"; die references connect directly to ideal rails']
  converted.warnings = ['Vendor signal-pin package RLC as a pi network with split shunt C; pdn="ideal" connects die POWER/GND references directly to perfect rails']
  return converted
}
