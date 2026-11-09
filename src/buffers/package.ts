import { convertIbisModelToSpice, parseIbis, type ConvertedGeneralIbisComponent } from '@tscircuit/ibis-to-spice'
import type { ModelRunDefinition } from './types'

/** Convert die buffers, retaining every vendor pin package under the supported ideal PDN. */
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
  const voltage = document.getBuffer(converted.metadata.pins[0].model).voltage[corner]
  if (voltage === null) throw new Error(`${component.name}: missing selected-corner voltage`)
  const referenceNodes = new Map(Object.entries(converted.spicePinMapping).flatMap(([terminal, port], i) => {
    const physical = Object.entries(input.definition.pinMap).find(([, mapped]) => mapped === port)?.[0]
    const pin = physical ? component.pins[physical] : undefined
    return pin && /^(power|gnd)$/i.test(pin.model) ? [[terminal, `DIE${i}`] as const] : []
  }))
  const dieGround = referenceNodes.get(groundTerminal)!
  for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
    const physical = Object.entries(input.definition.pinMap).filter(([, value]) => value === port)
    if (physical.length !== 1) throw new Error(`${port}: package pin mapping is ambiguous`)
    const pin = component.pins[physical[0][0]]
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
    const reference = referenceNodes.get(terminal)
    if (reference) {
      elements.push(`VPDN${i} ${reference} 0 ${/^power$/i.test(pin.model) ? voltage : 0}`, `VPKG${i} ${node} ${reference} 0`)
      nodes.set(terminal, reference)
    } else nodes.set(terminal, node)
    const value = pin.capacitance ?? component.package.capacitance?.[corner]
    if (value === undefined || value === null || value < 0) throw new Error(`${physical[0][0]}: vendor package capacitance missing`)
    if (value > 0) {
      elements.push(`CPKG${i}a ${terminal} ${dieGround} ${value / 2}`, `CPKG${i}b ${node} ${dieGround} ${value / 2}`)
    }
  }
  const body = wrapper.map((line, index) => index <= header ? line : line.replace(/\S+/g, token => nodes.get(token) ?? token))
  converted.source = [...body, ...elements].join('\n') + converted.source.slice(top)
  converted.metadata.packagePolicy = 'vendor'
  converted.metadata.omissions = []
  converted.warnings = ['Vendor pin package RLC retained; pdn="ideal" constrains die POWER/GND nodes, including behind the reference-pin packages']
  return converted
}
