import { convertIbisModelToSpice, parseIbis } from '@tscircuit/ibis-to-spice'
import type { ModelRunDefinition, PackagedComponent } from './types'
import { referenceVoltages } from './inspect'
import { coupledPackage, coupledPackageElements, packageComparisons } from './coupled-package'

/** Convert die buffers, retaining every vendor pin package with ideal die rails. */
export function convertPackaged(bytes: Uint8Array, input: ModelRunDefinition): PackagedComponent {
  const text = new TextDecoder().decode(bytes)
  const document = parseIbis(text)
  const component = document.components[input.definition.component]
  if (!component) throw new Error(`Missing IBIS component ${input.definition.component}`)
  const converted: PackagedComponent = convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, input.run)
  const physicalPins = Object.values(converted.spicePinMapping).map(port => {
    const physical = Object.keys(input.definition.pinMap).filter(pin => input.definition.pinMap[pin] === port)
    if (physical.length !== 1) throw new Error(`${port}: package pin mapping is ambiguous`)
    return physical[0]
  })
  const selected = coupledPackage(text, component, physicalPins)
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
  const voltages = new Map<string, number>()
  for (const pin of converted.metadata.pins) {
    for (const [role, voltage] of Object.entries(referenceVoltages(document.getBuffer(pin.model)))) {
      const port = pin.references[role as keyof ReturnType<typeof referenceVoltages>]
      if (voltages.has(port) && Math.abs(voltages.get(port)! - voltage) > 1e-8) throw new Error(`${port}: incompatible IBIS die voltages`)
      voltages.set(port, voltage)
    }
  }
  const referenceNodes = new Map(Object.entries(converted.spicePinMapping).flatMap(([terminal, port], i) => {
    const physical = Object.entries(input.definition.pinMap).find(([, mapped]) => mapped === port)?.[0]
    const pin = physical ? component.pins[physical] : undefined
    return pin && /^(power|gnd)$/i.test(pin.model) ? [[terminal, `DIE${i}`] as const] : []
  }))
  const dieGround = referenceNodes.get(groundTerminal)!
  if (!dieGround) throw new Error(`${component.name}: package ground must map to a physical GND pin`)
  const terminals = Object.keys(converted.spicePinMapping)
  for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
    const pin = component.pins[physicalPins[i]]
    let node = terminal
    for (const [field, kind] of [['resistance', 'R'], ['inductance', 'L']] as const) {
      const value = selected ? 0 : pin[field] ?? component.package[field]?.[0]
      if (value === undefined || value === null || value < 0) throw new Error(`${physicalPins[i]}: vendor package ${field} missing`)
      if (value > 0) {
        const next = `PKG${kind}${i}`
        elements.push(`${kind}PKG${i} ${node} ${next} ${value}`)
        node = next
      }
    }
    if (selected) node = `PKGD${i}`
    const reference = referenceNodes.get(terminal)
    if (reference) {
      const voltage = voltages.get(port) ?? (/^gnd$/i.test(pin.model) ? 0 : undefined)
      if (voltage === undefined) throw new Error(`${port}: no selected model defines this die rail`)
      elements.push(`VPDN${i} ${reference} 0 ${voltage}`, `VPKG${i} ${node} ${reference} 0`)
      nodes.set(terminal, reference)
    } else nodes.set(terminal, node)
    const value = selected ? 0 : pin.capacitance ?? component.package.capacitance?.[0]
    if (value === undefined || value === null || value < 0) throw new Error(`${physicalPins[i]}: vendor package capacitance missing`)
    if (value > 0) {
      elements.push(`CPKG${i}a ${terminal} ${dieGround} ${value / 2}`, `CPKG${i}b ${node} ${dieGround} ${value / 2}`)
    }
  }
  if (selected) {
    elements.push(...coupledPackageElements(selected, terminals, terminals.map((_, i) => `PKGD${i}`), dieGround))
    converted.metadata.packageData.matrices = selected
    converted.metadata.packageData.unusedPinPolicy = 'open-series-leads-floating-charge; unused loads, switching and circulating currents neglected'
    for (const [i, pin] of physicalPins.entries()) {
      const metadata = converted.metadata.packageData.mappedPins.find(entry => entry.physicalPin === pin)!
      Object.assign(metadata, { resistanceOhms: selected.R[i][i], inductanceHenries: selected.L[i][i], capacitanceFarads: selected.C[i][i] })
    }
  }
  const body = wrapper.map((line, index) => index <= header ? line : line.replace(/\S+/g, token => nodes.get(token) ?? token))
  converted.source = [...body, ...elements].join('\n') + converted.source.slice(top)
  converted.metadata.packagePolicy = 'vendor'
  converted.metadata.omissions = []
  converted.warnings = ['Vendor pin package RLC retained; Ideal rails constrain die POWER/GND nodes, including behind the reference-pin packages']
  if (selected) converted.warnings.push('Coupled package: open unused series leads; floating-charge capacitance reduction; unused pin loads, switching and circulating currents neglected; one lumped pi section', ...packageComparisons(component, selected))
  return converted
}
