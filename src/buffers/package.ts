import { convertIbisModelToSpice, parseIbis, type ConvertedGeneralIbisComponent } from '@tscircuit/ibis-to-spice'
import type { ModelRunDefinition } from './types'
import { convertDie } from './die'

/** Convert die buffers, then insert each vendor package exactly once, including supply pins. */
export function convertPackaged(bytes: Uint8Array, input: ModelRunDefinition): ConvertedGeneralIbisComponent {
  const document = parseIbis(new TextDecoder().decode(bytes))
  const component = document.components[input.definition.component]
  if (!component) throw new Error(`Missing IBIS component ${input.definition.component}`)
  if (component.coupledPackage) throw new Error(`${component.name}: coupled [Package Model] requires a supported package matrix; scalar fallback is forbidden`)
  const needsDisabled = Object.entries(input.definition.pinMap).some(([pin, port]) => {
    const physical = component.pins[pin]
    const choices = document.selectors[physical?.model] ?? [physical?.model]
    const name = input.definition.modelSelections?.[pin] ?? choices[0]
    return !/^(power|gnd|nc)$/i.test(physical?.model ?? '') && document.getBuffer(name).type === 'output' && (input.run.pinStates[port]?.mode === 'input' || input.run.pinStates[port]?.mode === 'output' && !Reflect.get(input.run.pinStates[port], 'enabled'))
  })
  const converted = needsDisabled ? convertDie(bytes, input) : convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, input.run)
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
    nodes.set(terminal, node)
  }
  for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
    const physical = Object.entries(input.definition.pinMap).find(([, value]) => value === port)![0]
    const value = component.pins[physical].capacitance ?? component.package.capacitance?.[corner]
    if (value === undefined || value === null || value < 0) throw new Error(`${physical}: vendor package capacitance missing`)
    if (value > 0) {
      const die = nodes.get(terminal)!
      const ground = nodes.get(groundTerminal)!
      if (die === ground) elements.push(`CPKG${i} ${terminal} ${ground} ${value}`)
      else elements.push(`CPKG${i}a ${terminal} ${ground} ${value / 2}`, `CPKG${i}b ${die} ${ground} ${value / 2}`)
    }
  }
  const body = wrapper.map((line, index) => index <= header ? line : line.replace(/\S+/g, token => nodes.get(token) ?? token))
  converted.source = [...body, ...elements].join('\n') + converted.source.slice(top)
  converted.metadata.packagePolicy = 'vendor'
  converted.metadata.omissions = []
  converted.warnings = ['Vendor scalar pin/package RLC as a pi network: shunt C split equally between board and die, with ground-pin C across its lead']
  return converted
}
