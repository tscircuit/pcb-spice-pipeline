import { isQuiet, type SimulationSignal } from '../board'

/** Finite capture after startup; quiet-only captures use 32 of the slowest UI. */
export function recordingTime(signals: SimulationSignal[]): { duration: number; gate: number } {
  const switching = signals.filter(signal => !isQuiet(signal))
  const ui = Math.max(...(switching.length ? switching : signals).map(signal => 1 / signal.bit_rate_bps))
  const gate = switching.length ? Math.max(...switching.map(signal => signal.offset_s + 16 / signal.bit_rate_bps)) : 16 * ui
  return { duration: switching.length ? gate + 128 * ui : 32 * ui, gate }
}
/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!)
  const right = Array.from(b, c => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}
