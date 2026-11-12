import type { RouteSlice } from '../board'
import type { CrossSectionResult } from './cross-section-types'

export interface RouteCoupling { wires: number[]; capacitive: number; inductive: number; retained: boolean }

/** Partition by pairwise solved coupling, retaining a pair if either normalized mutual exceeds 0.5%.
 * Connected components keep intervening conductors together; this is a local pair screen,
 * not a bound on aggregate waveform error or on fields beyond the geometry admission cap.
 */
export function routeCoupling(slice: RouteSlice, solve: (slice: RouteSlice) => CrossSectionResult, records: RouteCoupling[]): RouteSlice[] {
  const groups = slice.wires.map((_, i) => i)
  for (let i = 0; i < slice.wires.length; i++) for (let j = i + 1; j < slice.wires.length; j++) {
    const line = solve({ ...slice, wires: [slice.wires[i], slice.wires[j]] })
    const capacitive = Math.abs(line.C[0][1]) / Math.sqrt(line.C[0][0] * line.C[1][1])
    const inductive = Math.abs(line.L[0][1]) / Math.sqrt(line.L[0][0] * line.L[1][1])
    const retained = Math.max(capacitive, inductive) >= .005
    records.push({ wires: [slice.wires[i].id, slice.wires[j].id], capacitive, inductive, retained })
    if (retained) {
      const from = groups[j]
      const to = groups[i]
      for (let k = 0; k < groups.length; k++) if (groups[k] === from) groups[k] = to
    }
  }
  return [...new Set(groups)].map(group => ({ ...slice, wires: slice.wires.filter((_, i) => groups[i] === group) }))
}
