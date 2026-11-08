import { parseIbis, convertIbisBuffer, logicalBitSchedule, bitWeights, type ConvertedGeneralIbisComponent, type IbisConversionMetadata } from '@tscircuit/ibis-to-spice'
import { sha256 } from '../kernel'
import type { ModelRunDefinition } from './types'

/** Assemble die buffers with passive receive/disabled states even on output-only models. */
export function convertDie(bytes: Uint8Array, input: ModelRunDefinition): ConvertedGeneralIbisComponent {
  const document = parseIbis(new TextDecoder().decode(bytes))
  const component = document.components[input.definition.component]
  if (!component) throw new Error(`Missing IBIS component ${input.definition.component}`)
  if (component.unsupportedFeatures?.length) throw new Error(`${component.name}: unsupported IBIS features ${component.unsupportedFeatures.join(', ')}`)
  const signals = Object.entries(input.definition.pinMap).filter(([pin]) => !/^(power|gnd|nc)$/i.test(component.pins[pin]?.model ?? '')).sort(([a], [b]) => a.localeCompare(b))
  const pins: IbisConversionMetadata['pins'] = []
  const bodies: string[] = []
  const weights: (number[][] | undefined)[] = []
  const schedules: (ReturnType<typeof logicalBitSchedule> | undefined)[] = []
  const name = `IBIS_${sha256(JSON.stringify([sha256(bytes), input])).slice(0, 20)}`
  for (const [i, [physicalPin, port]] of signals.entries()) {
    const pin = component.pins[physicalPin]
    if (!pin) throw new Error(`${physicalPin}: missing physical IBIS pin`)
    const choices = document.selectors[pin.model] ?? [pin.model]
    const model = input.definition.modelSelections?.[physicalPin] ?? (choices.length === 1 ? choices[0] : undefined)
    if (!model || !choices.includes(model)) throw new Error(`${physicalPin}: select a model from ${choices.join(', ')}`)
    const buffer = document.getBuffer(model)
    const state = input.run.pinStates[port]
    if (!state) throw new Error(`${port}: missing derived state`)
    const enabled = state.mode === 'output' && state.enabled
    if (enabled && buffer.type === 'input') throw new Error(`${port}: input-only model cannot drive`)
    const references = input.definition.references?.[physicalPin]
    if (!references?.pullup || !references.pulldown || !references.powerClamp || !references.groundClamp) throw new Error(`${port}: explicit reference rails required`)
    const stimulus = input.run.stimuli[port]
    if (enabled && !stimulus) throw new Error(`${port}: driver stimulus missing`)
    const schedule = enabled ? logicalBitSchedule(stimulus, input.run.duration, buffer.polarity) : undefined
    const converted = convertIbisBuffer(document, model, { corner: input.definition.corner, mode: enabled ? 'output' : 'input', separateReferences: true,
      externalReference: Boolean(references.external), skipSwitchingWeights: !schedule?.transitions.length })
    bodies.push(converted.source.replaceAll(converted.name, `${name}_BUF${i}`))
    schedules.push(schedule)
    pins.push({ physicalPin, port, model, selector: pin.model, selectorChoices: choices, modelType: buffer.type, polarity: buffer.polarity ?? 'non-inverting', polarityDeclared: buffer.polarity !== undefined,
      runState: state, references: references as IbisConversionMetadata['pins'][number]['references'], stimulusHash: schedule?.sha256 })
    // Retain the converter's measured switching weights for each actual edge.
    weights.push(schedule ? bitWeights(converted, schedule) : undefined)
  }
  const rails = [...new Set(pins.flatMap(pin => Object.values(pin.references)))].sort()
  const mapping: Record<string, string> = Object.fromEntries(pins.map((pin, i) => [`PAD${i}`, pin.port]))
  rails.forEach((port, i) => { mapping[`REF${i}`] = port })
  /** Wrapper node for an explicitly mapped chip reference. */
  const reference = (port: string): string => `REF${rails.indexOf(port)}`
  const lines = [`* Vendor die buffers; original IBIS SHA-256 ${sha256(bytes)}`, `.subckt ${name} ${Object.keys(mapping).join(' ')}`]
  for (const [i, pin] of pins.entries()) {
    const schedule = schedules[i]
    if (schedule) {
      for (const [label, column] of [['KU', 1], ['KD', 2]] as const) lines.push(`V${label}${i} ${label}${i} ${reference(pin.references.pulldown)} PWL(${weights[i]!.map(row => `${row[0]} ${row[column]}`).join(' ')})`)
    }
    lines.push(`XBUF${i} PAD${i} ${[pin.references.pullup, pin.references.pulldown, pin.references.powerClamp, pin.references.groundClamp, ...(pin.references.external ? [pin.references.external] : [])].map(reference).join(' ')}${schedule ? ` KU${i} KD${i}` : ''} ${name}_BUF${i}`)
  }
  lines.push(`.ends ${name}`, ...bodies)
  const corner = { typical: 0, minimum: 1, maximum: 2 }[input.definition.corner]
  return { source: lines.join('\n') + '\n', spicePinMapping: mapping, sourceSha256: sha256(bytes), warnings: [], metadata: {
    tableExtrapolation: 'hold-endpoint-current', converterVersion: '0.0.2', sourceSha256: sha256(bytes), packagePolicy: 'omit', omissions: [], differentialPins: component.differentialPins, pins,
    packageData: { mappedPins: Object.entries(input.definition.pinMap).map(([physicalPin, port]) => {
      const pin = component.pins[physicalPin]
      return { physicalPin, port, role: pins.some(pin => pin.port === port) ? 'signal' as const : 'reference' as const,
        resistanceOhms: pin.resistance ?? component.package.resistance?.[corner] ?? null, inductanceHenries: pin.inductance ?? component.package.inductance?.[corner] ?? null,
        capacitanceFarads: pin.capacitance ?? component.package.capacitance?.[corner] ?? null }
    }) },
  } }
}
