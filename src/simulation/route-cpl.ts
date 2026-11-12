import { routePosition, type RouteWire, type RouteXY } from '../board'
import { referenceSeries, type ExtractedRoutes, type RouteReturn } from '../extraction'
import type { Produced } from '../kernel'
import type { RouteLadder } from './route-ladder'
import { RouteNetworkSolver } from './route-network'
import type { RoutedDeck, RouteNetworkInput } from './routed-types'

/** Stable SI precision, matching the existing lumped energy writer. */
const number = (value: number): string => Number(value.toPrecision(12)).toString()

/** ngspice ReadCpL consumes row-major upper triangles for every matrix, including R/G. */
function triangle(matrix: number[][]): string {
  return matrix.flatMap((row, i) => row.slice(i).map(number)).join(' ')
}

/** Research-only constant-parameter sections; physical endpoints chain changing conductor sets.
 * Grounded rail L is Schur-reduced before selecting active conductors. C uses its
 * fixed-voltage principal block. DC R and G=0 deliberately omit dispersive losses.
 * No conductor partitioning is allowed to silently discard a retained coupling.
 */
export function* routeCplSteps(extracted: ExtractedRoutes, endpoint: (wire: RouteWire, point: RouteXY) => string, _riseSeconds: number, _refinement: number = 1, _cellsPerRise: number = 10, returnPath?: RouteReturn): Generator<RouteLadder, RouteLadder> {
  if (returnPath) throw new Error('CPL research does not implement hybrid return matrices')
  const result: RouteLadder = { lines: [], cells: 0, maximumDelaySeconds: 0, wireNodes: new Map(), model: 'research CPL/LTRA: DC R, extracted L/C, G=0', warnings: [
    'Research CPL/LTRA omits skin resistance and dielectric loss/dispersion; comparison with the causal-loss ladder changes the physical model. Not accuracy-qualified.',
    'CPL has at most eight active conductors; shorter sections can force sub-picosecond steps despite integer-picosecond internal history. Boundary-only oblique placement is unqualified.',
    'Distributed evidence cells counts conductor sections, not lumped ladder cells. Bends retain physical endpoint continuity; existing bend excess omission and lumped vias/pads remain.',
  ] }
  for (const [index, slice] of extracted.slices.entries()) {
    const grounded = slice.wires.flatMap((wire, i) => endpoint(wire, routePosition(wire, slice.start)) === '0' && endpoint(wire, routePosition(wire, slice.end)) === '0' ? [i] : [])
    const active = slice.wires.map((_, i) => i).filter(i => !grounded.includes(i))
    if (!active.length) continue
    if (active.length > 8) throw new Error(`CPL section ${index} has ${active.length} active conductors; ngspice supports at most 8`)
    const length = (slice.end - slice.start) / 1000
    if (!(length > 0)) throw new Error('CPL section requires positive length')
    const series = referenceSeries(slice.line, grounded)
    const L = active.map(i => active.map(j => series.L[i][j]))
    const C = active.map(i => active.map(j => slice.line.C[i][j]))
    const R = active.map(i => active.map(j => slice.line.dcResistance[i][j]))
    if ([L, C, R].some(matrix => matrix.flat().some(value => !Number.isFinite(value)))) throw new Error('CPL requires finite matrices')
    if (R.some((row, i) => row.some((value, j) => i !== j && value !== 0))) throw new Error('CPL research requires diagonal DC resistance')
    const before = active.map(i => endpoint(slice.wires[i], routePosition(slice.wires[i], slice.start)))
    const after = active.map(i => endpoint(slice.wires[i], routePosition(slice.wires[i], slice.end)))
    for (const [column, i] of active.entries()) {
      const records = result.wireNodes.get(slice.wires[i].id) ?? []
      records.push({ position: slice.start, node: before[column] }, { position: slice.end, node: after[column] })
      result.wireNodes.set(slice.wires[i].id, records)
    }
    const model = `ROUTECPL${index}`
    if (active.length === 1) result.lines.push(`O${model} ${before[0]} 0 ${after[0]} 0 ${model}`, `.model ${model} LTRA R=${number(R[0][0])} L=${number(L[0][0])} G=0 C=${number(C[0][0])} LEN=${number(length)}`)
    else result.lines.push(`P${model} ${before.join(' ')} 0 ${after.join(' ')} 0 ${model}`, `.model ${model} CPL length=${number(length)}`, `+ R=${triangle(R)}`, `+ L=${triangle(L)}`, `+ G=${triangle(R.map(row => row.map(() => 0)))}`, `+ C=${triangle(C)}`)
    result.cells += active.length
    result.maximumDelaySeconds = Math.max(result.maximumDelaySeconds, length * Math.sqrt(Math.max(...L.map(row => row.reduce((sum, value) => sum + Math.abs(value), 0))) * Math.max(...C.map(row => row.reduce((sum, value) => sum + Math.abs(value), 0)))))
    yield result
  }
  return result
}

/** Alternate research entry shares binding, aliases, IBIS, transitions and oblique corrections. */
export function compileRouteCpl(input: RouteNetworkInput): Produced<RoutedDeck> {
  const solver = new RouteNetworkSolver(input, routeCplSteps)
  solver.solve()
  return solver.getOutput()
}
