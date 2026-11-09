import type { SimulationSignal } from '../board'

/** Pattern length in bits, including the full PRBS period. */
export function patternPeriod(pattern: string): number {
  const order = /^prbs(7|15|31)$/.exec(pattern)
  return order ? 2 ** Number(order[1]) - 1 : pattern === 'clock' ? 2 : pattern.length
}
/** Greatest common divisor for exact decimal rate arithmetic. */
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a
}
/** Express a finite positive decimal number as an exact rational. */
function fraction(value: number): [bigint, bigint] {
  const [mantissa, exponent = '0'] = String(value).split('e')
  const decimals = mantissa.split('.')[1]?.length ?? 0
  const power = Number(exponent) - decimals
  const digits = BigInt(mantissa.replace('.', ''))
  return power >= 0 ? [digits * 10n ** BigInt(power), 1n] : [digits, 10n ** BigInt(-power)]
}
/** Common settling gate and least common joint pattern period, with one complete extra UI. */
export function recordingTime(signals: SimulationSignal[]): { duration: number; gate: number; period: number } {
  const switching = signals.filter(s => !s.quiet)
  if (!switching.length) {
    const ui = Math.max(...signals.map(s => 1 / s.bit_rate_bps))
    return { duration: 32 * ui, gate: 16 * ui, period: 0 }
  }
  const gate = Math.max(...switching.map(s => s.offset_s + 16 / s.bit_rate_bps))
  let numerator = 1n
  let denominator = 0n
  for (const signal of switching) {
    const [rateN, rateD] = fraction(signal.bit_rate_bps)
    const bits = BigInt(patternPeriod(signal.pattern)) * rateD
    const common = gcd(bits, rateN)
    const n = bits / common
    const d = rateN / common
    numerator = numerator / gcd(numerator, n) * n
    denominator = gcd(denominator, d)
  }
  const period = Number(numerator) / Number(denominator)
  const duration = Math.max(...switching.map(s => s.offset_s + Math.ceil((gate - s.offset_s) * s.bit_rate_bps - 1e-10) / s.bit_rate_bps + period + 1 / s.bit_rate_bps))
  if (!Number.isFinite(duration)) throw new Error('Joint pattern duration is not finite')
  return { duration, gate, period }
}
/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!)
  const right = Array.from(b, c => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}
/** The RFC phase plan; advance all-ones using binary linear transforms even for PRBS31. */
export function plannedSeed(pattern: string, name: string, signals: { pattern: string; name: string }[]): number {
  const width = Number(pattern.slice(4))
  const period = 2 ** width - 1
  const names = [...new Set(signals.filter(s => s.pattern === pattern).map(s => s.name))].sort(compareNames)
  if (names.length > period) throw new Error(`${pattern}: more than ${period} signal names`)
  let steps = Math.floor(names.indexOf(name) * period / names.length)
  const tap = width === 31 ? 28 : width - 1
  /** One common generator step without signed 32-bit coercion of the state. */
  const advance = (state: number): number => ((state * 2) % (period + 1)) + (((state >>> (width - 1)) ^ (state >>> (tap - 1))) & 1)
  let transform = Array.from({ length: width }, (_, i) => advance(2 ** i))
  /** Apply a GF(2) state transition by its columns. */
  const apply = (columns: number[], state: number): number => columns.reduce((result, column, i) => result ^ (((state >>> i) & 1) ? column : 0), 0) >>> 0
  let state = period
  while (steps) {
    if (steps % 2) state = apply(transform, state)
    transform = transform.map(column => apply(transform, column))
    steps = Math.floor(steps / 2)
  }
  return state
}
