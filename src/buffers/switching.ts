import { convertIbisModelToSpice, convertIbisBuffer, logicalBitSchedule, ibisTimeSeconds, cornerValue, interpolate, sourceHash, spiceNumber, IbisError } from '@tscircuit/ibis-to-spice'
import type { IbisBuffer, IbisCorner, IbisDocument, LogicalSchedule } from '@tscircuit/ibis-to-spice'
import type { ModelRunDefinition, PackagedComponent } from './types'
import { fitWeights, type WeightFitOptions } from './weight-fit'

type Weights = Array<[number, number, number]>
type Edge = 'rising' | 'falling'
const tolerance = .01

/** Evidence for a bounded inactive-tail approximation, never an active-edge interruption. */
export interface SwitchingTail {
  physicalPin: string
  model: string
  edge: Edge
  originalDurationSeconds: number
  retainedDurationSeconds: number
  coefficientTolerance: number
  maxCoefficientDeviation: number
  maxCoefficientHoldError: number
  fixtures: { resistanceOhms: number; voltage: number; toleranceVolts: number; maxDeviationVolts: number }[]
}

/** Earliest sample whose entire suffix stays in tolerance; a late excursion resets the window. */
function settledIndex(deviations: number[], limit: number): number {
  let index = deviations.length
  while (index > 0 && deviations[index - 1] <= limit) index--
  return index
}

/** Check original two-fixture voltages AND the extracted coefficients, including the complete tail. */
function settledTail(buffer: IbisBuffer, corner: IbisCorner, edge: Edge, weights: Weights, physicalPin: string): SwitchingTail | undefined {
  const target = edge === 'rising' ? [1, 0] : [0, 1]
  const deviations = weights.map(row => Math.max(Math.abs(row[1] - target[0]), Math.abs(row[2] - target[1])))
  const index = settledIndex(deviations, tolerance)
  if (index === weights.length) return undefined
  let time = weights[index][0]
  const waves = buffer.waveforms.filter(wave => wave.kind === edge).slice(0, 2)
  const tables = waves.map(wave => wave.data.map(([t, ...values]) => [t, cornerValue(values, corner, edge)] as [number, number]))
  for (const table of tables) {
    const final = table.at(-1)![1]
    const limit = tolerance * Math.abs(final - table[0][1])
    const start = settledIndex(table.map(row => Math.abs(row[1] - final)), limit)
    time = Math.max(time, table[start][0])
  }
  const cut = weights.findIndex(row => row[0] >= time)
  if (cut < 0) return undefined
  time = weights[cut][0]
  return {
    physicalPin, model: buffer.name, edge, originalDurationSeconds: weights.at(-1)![0], retainedDurationSeconds: time,
    coefficientTolerance: tolerance, maxCoefficientDeviation: Math.max(...deviations.slice(cut)),
    maxCoefficientHoldError: Math.max(...weights.slice(cut).flatMap(row => [Math.abs(row[1] - weights[cut][1]), Math.abs(row[2] - weights[cut][2])])),
    fixtures: tables.map((table, i) => ({
      resistanceOhms: waves[i].resistance, voltage: cornerValue(waves[i].fixtureVoltage, corner, 'V_fixture'),
      toleranceVolts: tolerance * Math.abs(table.at(-1)![1] - table[0][1]),
      maxDeviationVolts: Math.max(...[interpolate(table, time), ...table.filter(row => row[0] >= time).map(row => row[1])].map(value => Math.abs(value - table.at(-1)![1]))),
    })),
  }
}

/** Stitch full measured coefficient edges, discarding only proven settled tails when necessary. */
function scheduleWeights(buffer: IbisBuffer, corner: IbisCorner, schedule: LogicalSchedule, physicalPin: string, document: IbisDocument, tails: SwitchingTail[], fit?: WeightFitOptions): Weights {
  const steady = schedule.initialState ? [1, 0] : [0, 1]
  const samples: Weights = [[0, steady[0], steady[1]]]
  if (!schedule.transitions.length) return [...samples, [schedule.duration, steady[0], steady[1]]]
  const weightsByEdge = fit
    ? { rising: fitWeights(buffer, corner, 'rising', fit), falling: fitWeights(buffer, corner, 'falling', fit) }
    : convertIbisBuffer(document, buffer.name, { corner, mode: 'output' }).weights!
  for (const [i, transition] of schedule.transitions.entries()) {
    const edge = transition.state ? 'rising' : 'falling'
    let weights = weightsByEdge[edge]
    if (weights[0][0] !== 0) throw new IbisError('unsupported_waveforms', 'Switching waveform must start at zero relative time')
    const next = schedule.transitions[i + 1]?.time
    if (next !== undefined && transition.time + weights.at(-1)![0] >= next) {
      const tail = settledTail(buffer, corner, edge, weights, physicalPin)
      if (!tail || transition.time + tail.retainedDurationSeconds > next)
        throw new IbisError('overlapping_edges', `${buffer.name}: actual ${edge} transition has not settled before the next edge (1% fixture swing and 0.01 switching-coefficient tolerances); active-transition interruption is unsupported`)
      weights = weights.filter(row => row[0] <= tail.retainedDurationSeconds)
      if (!tails.some(entry => entry.physicalPin === physicalPin && entry.edge === edge)) tails.push(tail)
    }
    // Each edge starts from the held coefficients. A femtosecond jump to the table's
    // first row (extraction residue up to the settled tolerance) forces sub-fs steps.
    const last = samples.at(-1)!
    weights = [[0, last[1], last[2]], ...weights.slice(1)]
    for (const [time, ku, kd] of weights) {
      const absolute = transition.time + time
      if (absolute > schedule.duration) break
      if (absolute === samples.at(-1)![0]) samples.pop()
      samples.push([absolute, ku, kd])
    }
    if (transition.time + weights.at(-1)![0] > schedule.duration) {
      const time = schedule.duration - transition.time
      samples.push([schedule.duration, interpolate(weights.map(row => [row[0], row[1]]), time), interpolate(weights.map(row => [row[0], row[2]]), time)])
    }
  }
  const last = samples.at(-1)!
  if (last[0] < schedule.duration) samples.push([schedule.duration, last[1], last[2]])
  return samples
}

/** Use upstream pin/reference and die-buffer conversion; the pipeline owns explicit edge scheduling. */
export function convertSwitching(bytes: Uint8Array, input: ModelRunDefinition, document: IbisDocument, fit?: WeightFitOptions): PackagedComponent {
  // Validate the ORIGINAL pattern before building the steady electrical skeleton.
  for (const stimulus of Object.values(input.run.stimuli)) logicalBitSchedule(stimulus, input.run.duration)
  const stimuli = Object.fromEntries(Object.entries(input.run.stimuli).map(([port, stimulus]) => [port,
    { ...stimulus, pattern: { ...stimulus.pattern, bits: String(stimulus.initialState), repeat: true } }]))
  const converted: PackagedComponent = convertIbisModelToSpice(bytes, { ...input.definition, packagePolicy: 'omit' }, { ...input.run, stimuli })
  const tails: SwitchingTail[] = []
  const schedules = converted.metadata.pins.map((pin, i) => {
    const stimulus = input.run.stimuli[pin.port]
    if (!stimulus) return undefined
    const buffer = document.getBuffer(pin.model)
    const schedule = logicalBitSchedule(stimulus, input.run.duration, buffer.polarity)
    pin.stimulusHash = schedule.sha256
    const samples = scheduleWeights(buffer, input.definition.corner, schedule, pin.physicalPin, document, tails, fit)
    for (const [label, column] of [['KU', 1], ['KD', 2]] as const) {
      converted.source = converted.source.replace(new RegExp(`^V${label}${i} (\\S+ \\S+) PWL\\(.*\\)$`, 'm'), (_, nodes: string) =>
        `V${label}${i} ${nodes} PWL(${samples.map(row => `${spiceNumber(row[0])} ${spiceNumber(row[column])}`).join(' ')})`)
    }
    return schedule
  })
  // Match upstream identity for untouched schedules, including source and true stimulus hashes.
  const original = /^\.subckt (\S+)/m.exec(converted.source)![1]
  if (fit) {
    converted.metadata.switchingWeightFit = { ...fit }
    converted.warnings.push('Research switching-weight fit: explicit derivative averaging and bounded coefficient PWL reduction; fixture voltage fidelity requires separate native replay')
  }
  const name = `IBIS_${sourceHash(JSON.stringify([converted.metadata, schedules, ibisTimeSeconds(input.run.duration)])).slice(0, 20)}`
  converted.source = converted.source.replaceAll(original, name)
  if (tails.length) {
    converted.metadata.switchingTails = tails
    converted.warnings = [...converted.warnings, 'IBIS inactive tails truncated only after all remaining two-fixture voltages and switching coefficients settle within the recorded 1% tolerances; retained endpoint coefficients are held, without time compression or initial-delay removal']
  }
  return converted
}
