import { bufferTables, cornerValue, interpolate, IbisError } from '@tscircuit/ibis-to-spice'
import type { IbisBuffer, IbisCorner } from '@tscircuit/ibis-to-spice'

type Weights = Array<[number, number, number]>

/** Explicit research parameters; fixture replay must qualify each chosen window. */
export interface WeightFitOptions {
  windowSeconds: number
  coefficientTolerance: number
}

/** Reduce both coefficient columns with one grid and a continuous PWL error bound. */
export function reduceWeights(rows: Weights, tolerance: number): Weights {
  if (!Number.isFinite(tolerance) || tolerance < 0 || rows.length < 2)
    throw new IbisError('invalid_options', 'Weight reduction needs at least two rows and a finite nonnegative tolerance')
  const keep = new Set([0, rows.length - 1])
  const pending = [[0, rows.length - 1]]
  while (pending.length) {
    const [first, last] = pending.pop()!
    let maximum = tolerance
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const fraction = (rows[i][0] - rows[first][0]) / (rows[last][0] - rows[first][0])
      const error = Math.max(...[1, 2].map(column => Math.abs(rows[i][column] - rows[first][column] - fraction * (rows[last][column] - rows[first][column]))))
      if (error > maximum) {
        maximum = error
        index = i
      }
    }
    if (index >= 0) {
      keep.add(index)
      pending.push([first, index], [index, last])
    }
  }
  return [...keep].sort((a, b) => a - b).map(index => [...rows[index]])
}

/**
 * Research extraction: average each fixture's PWL derivative over an explicit
 * time window, solve the same two-fixture KCL, then reduce its common PWL grid.
 * A secant is the exact average derivative, avoiding union-grid differentiation
 * across near-coincident knots. It preserves the independent KU/KD solution,
 * including negative/nonmonotone values; neither KU+KD=1 nor clipping is assumed.
 * The coefficient bound covers reduction only, not derivative regularization.
 * This is deliberately not the default converter: ngspice fixture replay must
 * establish the voltage error for the model, corner and window being studied.
 */
export function fitWeights(buffer: IbisBuffer, corner: IbisCorner, edge: 'rising' | 'falling', options: WeightFitOptions): Weights {
  const { windowSeconds, coefficientTolerance } = options
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0)
    throw new IbisError('invalid_options', 'Weight derivative window must be finite and positive')
  const waves = buffer.waveforms.filter(wave => wave.kind === edge).slice(0, 2)
  if (waves.length !== 2)
    throw new IbisError('unsupported_waveforms', `${buffer.name}: two ${edge} resistive waveforms are required`)
  const tables = waves.map(wave => wave.data.map(([time, ...values]) => [time, cornerValue(values, corner, edge)] as [number, number]))
  if (tables.some(table => table[0][0] !== 0))
    throw new IbisError('unsupported_waveforms', 'Research extraction requires a zero relative time origin')
  const duration = Math.max(...tables.map(table => table.at(-1)![0]))
  const count = Math.ceil(duration / (windowSeconds / 2))
  if (count > 32768)
    throw new IbisError('stimulus_too_long', 'Research extraction exceeds 32768 time intervals; choose an explicit larger window')
  const { voltage: current } = bufferTables(buffer, corner)
  const capacitance = cornerValue(buffer.capacitance, corner, 'C_comp')
  const rows: Weights = Array.from({ length: count + 1 }, (_, i) => {
    const time = duration * i / count
    const values = tables.map(table => interpolate(table, time))
    const currents = values.map(value => ({
      up: interpolate(current.pu, value), down: interpolate(current.pd, value),
      clamp: interpolate(current.pc, value) + interpolate(current.gc, value),
    }))
    const right = tables.map((table, index) => {
      const first = Math.max(0, time - windowSeconds / 2)
      const last = Math.min(duration, time + windowSeconds / 2)
      const slope = (interpolate(table, last) - interpolate(table, first)) / (last - first)
      return (cornerValue(waves[index].fixtureVoltage, corner, 'V_fixture') - values[index]) / waves[index].resistance - capacitance * slope - currents[index].clamp
    })
    const [a, b] = currents
    const determinant = a.up * b.down - a.down * b.up
    const norm = a.up ** 2 + a.down ** 2 + b.up ** 2 + b.down ** 2
    // |det(A)| / ||A||F² = 1/(condition(A) + 1/condition(A)).
    // Refuse condition numbers around 10^6 rather than invent a smooth solution.
    if (Math.abs(determinant) <= norm * 1e-6)
      throw new IbisError('singular_waveforms', `${buffer.name}: ill-conditioned ${edge} fixtures at ${time} s`)
    const up = (right[0] * b.down - a.down * right[1]) / determinant
    const down = (a.up * right[1] - right[0] * b.up) / determinant
    if (![up, down].every(Number.isFinite))
      throw new IbisError('nonfinite_conversion', `${buffer.name}: invalid research switching weights`)
    return [time, up, down]
  })
  return reduceWeights(rows, coefficientTolerance)
}
