import * as converter from '@tscircuit/ibis-to-spice'
import { fail } from './diagnostics'
import type { ModelRunDefinition } from './types'

/** Adds all mapped pin R/L and pad-to-board-ground C around an omitted-package converter core.
 * IBIS 7.2 §3 [Package]/[Pin]: per-pin values override corner-selected package defaults.
 * The original admitted vendor bytes and SHA remain unchanged.
 */
export function convertWithPackage(bytes: Uint8Array, input: ModelRunDefinition): converter.ConvertedGeneralIbisComponent {
  if (input.definition.packagePolicy === 'omit') return converter.convertIbisModelToSpice(bytes, input.definition, input.run)
  const result = converter.convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, input.run)
  const document = converter.parseIbis(new TextDecoder().decode(bytes))
  const component = document.components[input.definition.component]
  if (component.coupledPackage) throw new converter.IbisError('unsupported_package', 'Coupled vendor package models need a package network extractor')
  const ground = result.metadata.pins[0].references.pulldown
  const groundTerminal = Object.entries(result.spicePinMapping).find(([, port]) => port === ground)![0]
  const data = result.metadata.packageData.mappedPins
  const wrapper = result.source.match(/^\.subckt\s+(\S+)\s+([^\r\n]+)\r?\n([^]*?)^\.ends[^\r\n]*/mi)!
  let core = wrapper[3]
  const lines: string[] = []
  for (const [i, [terminal, port]] of Object.entries(result.spicePinMapping).entries()) {
    const pin = data.find(p => p.port === port)!
    for (const [name, value] of Object.entries({ R: pin.resistanceOhms, L: pin.inductanceHenries, C: pin.capacitanceFarads })) {
      if (value === null || value === undefined || !Number.isFinite(value) || value < 0) throw new converter.IbisError('invalid_package', `${pin.physicalPin}: vendor ${name} must be present, finite and nonnegative (explicit zero is allowed)`)
    }
    if (pin.role === 'reference' && pin.inductanceHenries! > 0 && result.metadata.pins.some(p => p.runState.mode === 'output' && p.runState.enabled)) fail('ibis_supply_dynamics', `${pin.physicalPin}: switching with inductive die supplies needs power-aware supply-current and rail-referenced die-capacitance data; this classic IBIS converter provides neither. Explicit packagePolicy=omit is the available ideal-supply alternative`)
    let previous = terminal
    if (pin.resistanceOhms) {
      lines.push(`RPKG${i} ${previous} PKGR${i} ${converter.spiceNumber(pin.resistanceOhms)}`)
      previous = `PKGR${i}`
    }
    if (pin.inductanceHenries) {
      lines.push(`LPKG${i} ${previous} PKGL${i} ${converter.spiceNumber(pin.inductanceHenries)}`)
      previous = `PKGL${i}`
    }
    if (pin.capacitanceFarads && terminal !== groundTerminal) lines.push(`CPKG${i} ${terminal} ${groundTerminal} ${converter.spiceNumber(pin.capacitanceFarads)}`)
    core = core.replace(new RegExp(`\\b${terminal}\\b`, 'g'), previous)
  }
  result.source = result.source.replace(wrapper[0], `.subckt ${wrapper[1]} ${wrapper[2]}\n${lines.join('\n')}\n${core}.ends ${wrapper[1]}`)
  result.metadata.packagePolicy = 'vendor'
  result.metadata.omissions = result.metadata.omissions.filter(w=>w !== 'Vendor package excluded by explicit packagePolicy=omit')
  result.warnings = result.warnings.filter(w=>w !== 'Vendor package excluded by explicit packagePolicy=omit')
  return result
}
