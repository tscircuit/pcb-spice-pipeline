import { parseIbis } from '@tscircuit/ibis-to-spice'
import type { ModelRunDefinition, PackagedComponent } from './types'
import { referenceVoltages } from './inspect'
import { coupledPackage, coupledPackageElements, packageComparisons, packageCapacitanceWarnings } from './coupled-package'
import { convertSwitching } from './switching'
import { sha256 } from '../kernel'
import type { WeightFitOptions } from './weight-fit'

/** Convert die buffers, retaining every vendor pin package with ideal die rails. */
export function convertPackaged(bytes: Uint8Array, input: ModelRunDefinition, sourceFile: string = input.definition.source.file ?? '(inline IBIS)', fit?: WeightFitOptions): PackagedComponent {
  const text = new TextDecoder().decode(bytes)
  const document = parseIbis(text)
  const component = document.components[input.definition.component]
  if (!component) throw new Error(`Missing IBIS component ${input.definition.component}`)
  const converted = convertSwitching(bytes, input, document, fit)
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
  const rails = new Map<string, string>()
  const referenceNodes = new Map(Object.entries(converted.spicePinMapping).flatMap(([terminal], i) => {
    const physical = physicalPins[i]
    const pin = component.pins[physical]
    if (!/^(power|gnd)$/i.test(pin.model)) return []
    const key = selected?.mergedPins[physical] ?? physical
    if (!rails.has(key)) rails.set(key, `DIE${i}`)
    return [[terminal, rails.get(key)!] as const]
  }))
  const dieGround = referenceNodes.get(groundTerminal)!
  if (!dieGround) throw new Error(`${component.name}: package ground must map to a physical GND pin`)
  const terminals = Object.keys(converted.spicePinMapping)
  const matrixTerminals = selected?.pins.map((pin, i) => terminals[physicalPins.indexOf(pin)] ?? `PKGM${i}`) ?? []
  const supplied = new Map<string, number>()
  for (const [i, [terminal, port]] of Object.entries(converted.spicePinMapping).entries()) {
    const pin = component.pins[physicalPins[i]]
    const matrixPin = selected?.mergedPins[physicalPins[i]] ?? physicalPins[i]
    const matrixIndex = selected?.pins.indexOf(matrixPin) ?? -1
    const scalar = matrixIndex < 0
    const tag = selected ? 'PKGU' : 'PKG'
    let node = terminal
    for (const [field, kind] of [['resistance', 'R'], ['inductance', 'L']] as const) {
      const value = scalar ? pin[field] ?? component.package[field]?.[0] : 0
      if (value === undefined || value === null || !Number.isFinite(value) || value < 0) throw new Error(`${physicalPins[i]}: vendor package ${field} missing`)
      if (value > 0) {
        const next = `${tag}${kind}${i}`
        elements.push(`${kind}${tag}${i} ${node} ${next} ${value}`)
        node = next
      }
    }
    if (!scalar) {
      node = `PKGD${matrixIndex}`
      if (matrixPin !== physicalPins[i]) elements.push(`VPKGM${i} ${terminal} ${matrixTerminals[matrixIndex]} 0`)
    }
    const reference = referenceNodes.get(terminal)
    if (reference) {
      const voltage = voltages.get(port) ?? (/^gnd$/i.test(pin.model) ? 0 : undefined)
      if (voltage === undefined) throw new Error(`${port}: no selected model defines this die rail`)
      if (supplied.has(reference) && Math.abs(supplied.get(reference)! - voltage) > 1e-8) throw new Error(`${component.name}: incompatible die voltages on merged package pin ${matrixPin}`)
      if (!supplied.has(reference)) elements.push(`VPDN${i} ${reference} 0 ${voltage}`, `VPKG${i} ${node} ${reference} 0`)
      supplied.set(reference, voltage)
      nodes.set(terminal, reference)
    } else nodes.set(terminal, node)
    const value = scalar ? pin.capacitance ?? component.package.capacitance?.[0] : 0
    if (value === undefined || value === null || !Number.isFinite(value) || value < 0) throw new Error(`${physicalPins[i]}: vendor package capacitance missing`)
    if (value > 0) {
      elements.push(`C${tag}${i}a ${terminal} ${dieGround} ${value / 2}`, `C${tag}${i}b ${node} ${dieGround} ${value / 2}`)
    }
  }
  if (selected) {
    elements.push(...coupledPackageElements(selected, matrixTerminals, selected.pins.map((_, i) => `PKGD${i}`), dieGround))
    converted.metadata.packageData.matrices = selected
    converted.metadata.packageData.unusedPinPolicy = 'open-series-leads-floating-charge; unused loads, switching and circulating currents neglected'
    for (const pin of physicalPins) {
      const i = selected.pins.indexOf(selected.mergedPins[pin] ?? pin)
      if (i < 0) continue
      const metadata = converted.metadata.packageData.mappedPins.find(entry => entry.physicalPin === pin)!
      Object.assign(metadata, { resistanceOhms: selected.R[i][i], inductanceHenries: selected.L[i][i], capacitanceFarads: selected.C[i][i] })
    }
  }
  const body = wrapper.map((line, index) => index <= header ? line : line.replace(/\S+/g, token => nodes.get(token) ?? token))
  converted.source = [...body, ...elements].join('\n') + converted.source.slice(top)
  converted.metadata.packagePolicy = 'vendor'
  converted.warnings = converted.warnings.filter(warning => !converted.metadata.omissions.includes(warning))
  converted.metadata.omissions = []
  converted.warnings.push('Vendor pin package RLC retained; Ideal rails constrain die POWER/GND nodes, including behind the reference-pin packages')
  if (selected) converted.warnings.push('Coupled package: open unused series leads; floating-charge capacitance reduction; unused pin loads, switching and circulating currents neglected; one lumped pi section; unlisted pins follow the IBIS [Pin]/[Package] hierarchy or merged rail bus rules', ...packageComparisons(component, selected))
  converted.warnings.push(...packageCapacitanceWarnings(selected, sourceFile, sha256(bytes)))
  return converted
}
