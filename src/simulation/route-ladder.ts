import { causalLossPoles, causalLossResponse, referenceSeries, type ExtractedRoutes, type ExtractedRouteSlice, type RouteReturn } from '../extraction'
import { RouteEnergy, seriesEnergy, shuntEnergy, skinEnergy } from './route-energy'
import { type RouteWire, type RouteXY } from '../board'

export interface RouteLadder {
  lines: string[]; cells: number; maximumDelaySeconds: number
  wireNodes: Map<number, { position: number; node: string }[]>
}

/** Deliberately conservative modal delay upper bound from matrix infinity norms. */
function delayPerMetre(slice: ExtractedRouteSlice): number {
  return Math.sqrt(Math.max(...slice.line.L.map(row => row.reduce((total, entry) => total + Math.abs(entry), 0))) * Math.max(...slice.line.C.map(row => row.reduce((total, entry) => total + Math.abs(entry), 0))))
}

interface ArcCell { wire: RouteWire; start: number; end: number; before: string; after: string }
interface ArcWire { offset: number; length: number; cells: number[]; sign: number }

/** Integrate every local matrix energy onto delay-bounded route-arc cells, independent of curve tessellation. */
export function* routeLadderSteps(extracted: ExtractedRoutes, endpoint: (wire: RouteWire, point: RouteXY) => string, riseSeconds: number, refinement: number = 1, cellsPerRise: number = 10, returnPath?: RouteReturn): Generator<RouteLadder, RouteLadder> {
  if (!(riseSeconds > 0) || !Number.isInteger(refinement) || refinement < 1 || refinement > 4) throw new Error('Positive rise time and bounded integer spatial refinement (1..4) required')
  if (!(cellsPerRise >= .5 && cellsPerRise <= 40)) throw new Error('Cells per rise time must be in [0.5,40]')
  const lines: string[] = []
  const wireNodes: RouteLadder['wireNodes'] = new Map()
  const wires = [...new Map(extracted.slices.flatMap(slice => slice.wires.map(wire => [wire.id, wire] as const))).values()].sort((a, b) => a.id - b.id)
  const maximumDelayPerMetre = Math.max(...extracted.slices.map(delayPerMetre))
  const targetMm = riseSeconds / cellsPerRise / refinement / maximumDelayPerMetre * 1000
  const dispersionMm = 2 * riseSeconds / maximumDelayPerMetre * 1000
  const cells: ArcCell[] = []
  const arc = new Map<number, ArcWire>()
  const contacts = new Map<string, number>()
  for (const wire of wires) for (const point of [wire.a, wire.b]) {
    const key = `${wire.layer}:${point.map(value => value.toFixed(6)).join(',')}`
    contacts.set(key, (contacts.get(key) ?? 0) + 1)
  }
  let cursor = 0
  while (cursor < wires.length) {
    const seed = wires[cursor++]
    if (endpoint(seed, seed.a) === endpoint(seed, seed.b)) continue
    const run = [seed]
    while (cursor < wires.length) {
      const wire = wires[cursor]
      const previous = run.at(-1)!
      const junction = contacts.get(`${wire.layer}:${wire.a.map(value => value.toFixed(6)).join(',')}`) ?? 0
      if (wire.aPort || junction > 2 || wire.trace !== seed.trace || wire.layer !== seed.layer || wire.width !== seed.width || Math.hypot(wire.a[0] - previous.b[0], wire.a[1] - previous.b[1]) > 1e-6) break
      run.push(wire)
      cursor++
    }
    let length = 0
    for (const wire of run) {
      arc.set(wire.id, { offset: length, length: wire.end - wire.start, cells: [], sign: (wire.b[0] - wire.a[0]) * wire.u[0] + (wire.b[1] - wire.a[1]) * wire.u[1] > 0 ? 1 : -1 })
      length += wire.end - wire.start
    }
    // Ladder dispersion accumulates along a run: phase error ~ delay x cell delay^2. Runs longer than two rise times
    // shrink their cells by sqrt(two rise times / run delay), which keeps the edge ripple independent of length.
    const count = Math.max(1, Math.ceil(length / targetMm * Math.max(1, Math.sqrt(length / dispersionMm))))
    const indices = Array.from({ length: count }, (_, i) => cells.length + i)
    /** Locate a physical point along the original (simplified) polyline, including its bends. */
    const point = (distance: number): { wire: RouteWire; position: RouteXY } => {
      const wire = run.find(wire => distance <= arc.get(wire.id)!.offset + arc.get(wire.id)!.length + 1e-7) ?? run.at(-1)!
      const entry = arc.get(wire.id)!
      const fraction = Math.max(0, Math.min(1, (distance - entry.offset) / entry.length))
      return { wire, position: [wire.a[0] + fraction * (wire.b[0] - wire.a[0]), wire.a[1] + fraction * (wire.b[1] - wire.a[1])] }
    }
    for (let i = 0; i < count; i++) {
      const start = length * i / count
      const end = length * (i + 1) / count
      const a = point(start)
      const b = point(end)
      cells.push({ wire: seed, start, end, before: endpoint(a.wire, a.position), after: endpoint(b.wire, b.position) })
    }
    for (const wire of run) {
      const entry = arc.get(wire.id)!
      entry.cells = indices
      const records = indices.flatMap(index => {
        const cell = cells[index]
        return [cell.start, cell.end].filter(position => position >= entry.offset - 1e-7 && position <= entry.offset + entry.length + 1e-7).map(position => ({
          position: entry.sign > 0 ? wire.start + position - entry.offset : wire.end - position + entry.offset,
          node: position === cell.start ? cell.before : cell.after,
        }))
      })
      if (!records.length) {
        const middle = entry.offset + entry.length / 2
        const cell = cells[indices.find(index => cells[index].end >= middle)!]
        records.push({ position: wire.start, node: cell.before }, { position: wire.end, node: cell.after })
      }
      wireNodes.set(wire.id, records)
    }
    yield { lines, cells: cells.length, maximumDelaySeconds: Math.max(...cells.map(cell => (cell.end - cell.start) / 1000 * maximumDelayPerMetre)), wireNodes }
  }
  const nodeNames = [...new Set(cells.flatMap(cell => [cell.before, cell.after]))].filter(node => node !== '0')
  const nodeIds = new Map(nodeNames.map((node, i) => [node, i]))
  /** Bound actual stored coupling terms, rather than unrelated route cells. */
  const budget = { entries: 0 }
  /** Allocate only nonzero energy terms. */
  const zero = (size: number): RouteEnergy => new RouteEnergy(size, budget)
  const R = zero(cells.length)
  const L = zero(cells.length)
  const skin = zero(cells.length)
  const C = zero(nodeNames.length)
  const D = zero(nodeNames.length)
  for (const slice of extracted.slices) {
    const series = referenceSeries(slice.line, slice.wires.flatMap((wire, i) => arc.has(wire.id) ? [] : [i]))
    const cuts = [slice.start, slice.end]
    for (const wire of slice.wires) {
      const entry = arc.get(wire.id)
      if (!entry) continue
      for (const index of entry.cells) for (const distance of [cells[index].start, cells[index].end]) {
        const position = entry.sign > 0 ? wire.start + distance - entry.offset : wire.end - distance + entry.offset
        if (position > slice.start + 1e-8 && position < slice.end - 1e-8) cuts.push(position)
      }
    }
    cuts.sort((a, b) => a - b)
    for (let part = 1; part < cuts.length; part++) {
      const metres = (cuts[part] - cuts[part - 1]) / 1000
      if (metres < 1e-12) continue
      const middle = (cuts[part] + cuts[part - 1]) / 2
      const entries = slice.wires.map(wire => {
        const entry = arc.get(wire.id)
        if (!entry) return undefined
        const distance = entry.offset + (entry.sign > 0 ? middle - wire.start : wire.end - middle)
        const index = entry.cells.find(index => distance >= cells[index].start - 1e-7 && distance <= cells[index].end + 1e-7)!
        if (index === undefined) throw new Error('Route arc cell did not cover a geometric section')
        return { index, sign: entry.sign, before: nodeIds.get(entry.sign > 0 ? cells[index].before : cells[index].after), after: nodeIds.get(entry.sign > 0 ? cells[index].after : cells[index].before) }
      })
      for (let i = 0; i < entries.length; i++) for (let j = 0; j < entries.length; j++) {
        const a = entries[i]
        const b = entries[j]
        if (!a || !b) continue
        const signedLength = metres * a.sign * b.sign
        R.add(a.index, b.index, slice.line.dcResistance[i][j] * signedLength)
        L.add(a.index, b.index, series.L[i][j] * signedLength)
        skin.add(a.index, b.index, series.skinResistance[i][j] * signedLength)
        for (const side of ['before', 'after'] as const) if (a[side] !== undefined && b[side] !== undefined) {
          C.add(a[side]!, b[side]!, slice.line.C[i][j] * metres / 2)
          D.add(a[side]!, b[side]!, slice.line.dielectricLoss[i][j] * metres / 2)
        }
      }
    }
  }
  if (returnPath) {
    const weights = cells.map(cell => {
      const index = returnPath.traces.findIndex(trace => trace.source === cell.wire.source)
      if (index < 0) throw new Error('Hybrid return does not cover every active routed trace')
      const route = returnPath.traces[index]
      const path = wires.filter(wire => wire.source === route.source)
      const first = path[0].a
      const last = path.at(-1)!.b
      const forward = Math.hypot(first[0] - route.start[0], first[1] - route.start[1]) < 1e-5
      if (!forward && Math.hypot(last[0] - route.start[0], last[1] - route.start[1]) >= 1e-5) throw new Error('Hybrid return endpoint orientation disagrees with routed geometry')
      const total = path.reduce((sum, wire) => sum + wire.end - wire.start, 0)
      const offset = path.slice(0, path.indexOf(cell.wire)).reduce((sum, wire) => sum + wire.end - wire.start, 0)
      const start = (offset + cell.start) / total
      const end = (offset + cell.end) / total
      return { index, weight: (forward ? 1 : -1) * (end - start), sign: forward ? 1 : -1, start: forward ? start : 1 - end, end: forward ? end : 1 - start }
    })
    // Congruence of averaged longitudinal currents preserves the positive return energy.
    for (let i = 0; i < cells.length; i++) for (let j = 0; j < cells.length; j++) {
      const a = weights[i]
      const b = weights[j]
      const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) * a.sign * b.sign
      const weight = returnPath.model === 'series' ? overlap : a.weight * b.weight
      R.set(i, j, (returnPath.model === 'series' ? 0 : R.rows[i].get(j) ?? 0) + weight * returnPath.R[a.index][b.index])
      L.set(i, j, (returnPath.model === 'series' ? 0 : L.rows[i].get(j) ?? 0) + weight * returnPath.L[a.index][b.index])
      if (returnPath.model === 'series') skin.set(i, j, 0)
    }
  }
  const before = cells.map(cell => cell.before)
  const after = cells.map(cell => cell.after)
  let current = cells.map((_, i) => `ARCd${i}`)
  seriesEnergy(lines, 'ARCD', before, current, R, 'R')
  if (returnPath?.model !== 'series') {
    const stages = causalLossPoles().map((_, p) => cells.map((_, i) => `ARCp${p}n${i}`))
    skinEnergy(lines, 'ARC', current, stages, skin, causalLossPoles())
    current = stages.at(-1)!
  }
  seriesEnergy(lines, 'ARCL', current, after, L, 'L')
  const dielectricAtReference = causalLossResponse(1e9).dielectricCapacitance
  const capacitance = C.scaled(1)
  for (const [i, row] of D.rows.entries()) for (const [j, value] of row) capacitance.rows[i].set(j, (C.rows[i].get(j) ?? 0) - dielectricAtReference * value)
  shuntEnergy(lines, 'ARCC', nodeNames, capacitance)
  for (const [p, pole] of causalLossPoles().entries()) shuntEnergy(lines, `ARCG${p}`, nodeNames, D.scaled(pole.dielectric), pole.rate)
  return { lines, cells: cells.length, maximumDelaySeconds: Math.max(...cells.map(cell => (cell.end - cell.start) / 1000 * maximumDelayPerMetre)), wireNodes }
}

/** Drain the canonical ladder assembly when interactive stepping is unnecessary. */
export function routeLadder(extracted: ExtractedRoutes, endpoint: (wire: RouteWire, point: RouteXY) => string, riseSeconds: number, refinement: number = 1, cellsPerRise: number = 10, returnPath?: RouteReturn): RouteLadder {
  const steps = routeLadderSteps(extracted, endpoint, riseSeconds, refinement, cellsPerRise, returnPath)
  let result = steps.next()
  while (!result.done) result = steps.next()
  return result.value
}
