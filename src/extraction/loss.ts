import { numerics } from '../kernel'
import type { LossFit } from './types'

/** Four nonnegative Foster branches fitted over the automatically derived frequency band. */
export function fitLoss(frequencies: number[], target: number[]): LossFit {
  const poles = Array.from({ length: numerics.lossBranches }, (_, i) => 2 * Math.PI * frequencies[0] * (frequencies.at(-1)! / frequencies[0]) ** (i / (numerics.lossBranches - 1)))
  const basis = frequencies.map(f => poles.map(p => (2 * Math.PI * f) ** 2 / ((2 * Math.PI * f) ** 2 + p ** 2)))
  const weights = poles.map(() => 0)
  const scale = target.map(v => Math.max(v, Math.max(...target) * numerics.fitZeroRelative))
  let previous = Infinity
  for (;;) {
    for (let j = 0; j < poles.length; j++) {
      let numerator = 0
      let denominator = 0
      for (let i = 0; i < target.length; i++) {
        const remaining = target[i] - basis[i].reduce((s, v, k) => s + (k === j ? 0 : v * weights[k]), 0)
        numerator += remaining * basis[i][j] / scale[i] ** 2
        denominator += basis[i][j] ** 2 / scale[i] ** 2
      }
      weights[j] = Math.max(0, numerator / denominator)
    }
    const error = target.reduce((s, v, i) => s + ((basis[i].reduce((a, b, j) => a + b * weights[j], 0) - v) / scale[i]) ** 2, 0)
    if (previous - error <= numerics.fitRelativeChange * Math.max(1, previous) && Number.isFinite(previous)) break
    previous = error
  }
  const errors = target.map((v, i) => Math.abs(basis[i].reduce((s, b, j) => s + b * weights[j], 0) - v) / scale[i])
  return { poles, weights, relativeRms: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length), maxRelative: Math.max(...errors) }
}
/** Real part of a fitted positive-real Foster impedance/admittance. */
export function fittedLoss(fit: LossFit, frequency: number): number {
  const omega = 2 * Math.PI * frequency
  return fit.weights.reduce((s, w, i) => s + w * omega ** 2 / (omega ** 2 + fit.poles[i] ** 2), 0)
}
