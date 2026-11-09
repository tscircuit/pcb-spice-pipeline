import { fail } from './diagnostics'
import { numerics, max } from '../kernel'
import type { LossFit } from './types'

/** Nonnegative Foster fitting with an explicit maximum-error contract and no branch cap. */
export function fitLoss(frequencies: number[], target: number[]): LossFit {
  if (!frequencies.length || frequencies.length !== target.length || frequencies.some((f, i) => !Number.isFinite(f) || f <= 0 || (i > 0 && f <= frequencies[i - 1])) || target.some(v => !Number.isFinite(v) || v < 0)) fail('loss_fit', 'Increasing positive frequencies and matching finite nonnegative loss samples are required')
  if (target.every(v => v === 0)) return {poles: [], weights: [], relativeRms: 0, maxRelative: 0}
  // Every positive Foster branch increases monotonically, with logarithmic slope in [0,2].
  for (let i = 1; i < target.length; i++) if (target[i] < target[i - 1] || target[i] > target[i - 1] * (frequencies[i] / frequencies[i - 1]) ** 2 * (1 + numerics.lossFitMaximumRelative)) fail('loss_fit', 'Target violates the monotonicity/slope bounds of a passive RL/RC Foster network')
  const floor = max(target) * numerics.fitZeroRelative
  const scale = target.map(v => Math.max(v, floor))
  let count = numerics.lossBranches as number
  let previousFit = Infinity
  for (;;) {
    // Out-of-band poles are essential for representing loss near either band endpoint.
    const lower = frequencies[0] / numerics.lossPoleExtension
    const upper = frequencies.at(-1)! * numerics.lossPoleExtension
    const poles = Array.from({length: count}, (_, i) => 2 * Math.PI * lower * (upper / lower) ** (i / (count - 1)))
    const basis = poles.map(p => frequencies.map((f, i) => (2 * Math.PI * f) ** 2 / ((2 * Math.PI * f) ** 2 + p ** 2) / scale[i]))
    const norm = basis.map(column => column.reduce((sum, v) => sum + v * v, 0))
    const weights = poles.map(() => 0)
    const residual = target.map((v, i) => v / scale[i])
    let previous = Infinity
    for (;;) {
      for (let j = 0; j < poles.length; j++) {
        const next = Math.max(0, weights[j] + basis[j].reduce((sum, v, i) => sum + v * residual[i], 0) / norm[j])
        const change = next - weights[j]
        for (let i = 0; i < residual.length; i++) residual[i] -= change * basis[j][i]
        weights[j] = next
      }
      const error = residual.reduce((sum, v) => sum + v * v, 0)
      if (!Number.isFinite(error)) fail('loss_fit', 'Nonfinite Foster objective')
      if (previous - error <= numerics.fitRelativeChange * Math.max(1, previous) && Number.isFinite(previous)) break
      previous = error
    }
    const maximum = max(residual.map(Math.abs))
    if (maximum <= numerics.lossFitMaximumRelative) return {poles, weights, maxRelative: maximum, relativeRms: Math.sqrt(residual.reduce((sum, v) => sum + v * v, 0) / residual.length)}
    if (previousFit - maximum <= Number.EPSILON * Math.max(1, previousFit) && Number.isFinite(previousFit)) fail('loss_fit', `Foster refinement cannot meet maximum relative error ${numerics.lossFitMaximumRelative}; residual ${maximum}`)
    previousFit = maximum
    count *= 2
  }
}
/** Real part of a fitted positive-real Foster impedance/admittance. */
export function fittedLoss(fit: LossFit, frequency: number): number {
  const omega = 2 * Math.PI * frequency
  return fit.weights.reduce((s, w, i) => s + w * omega ** 2 / (omega ** 2 + fit.poles[i] ** 2), 0)
}

/** Imaginary part divided by angular frequency of the same causal Foster branch. */
export function fittedStorage(fit: LossFit, frequency: number): number {
  const omega = 2 * Math.PI * frequency
  return fit.weights.reduce((sum, weight, i) => sum + weight * fit.poles[i] / (omega ** 2 + fit.poles[i] ** 2), 0)
}
