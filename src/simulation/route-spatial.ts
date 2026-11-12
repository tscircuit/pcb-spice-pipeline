import { fail } from './diagnostics'
import { parseSpiceVectors, formatSpiceVectors, type SpiceVector } from '../observation'
import { sha256 } from '../kernel'

/** One electrical ladder node in the Circuit JSON board coordinate frame (mm). */
export interface RouteSpatialPoint {
  node: string
  net: string
  layer: string
  x: number
  y: number
}

/** Bounded spatial capture; volts[pointIndex][timeIndex] is ground-referenced voltage. */
export interface RouteSpatialWaveform {
  points: RouteSpatialPoint[]
  timeSeconds: number[]
  volts: number[][]
}

/** Even index decimation retains both ends and never exceeds the requested count. */
function sampleIndices(length: number, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [Math.floor((length - 1) / 2)]
  if (length <= count) return Array.from({ length }, (_, i) => i)
  return Array.from({ length: count }, (_, i) => Math.round(i * (length - 1) / (count - 1)))
}

/** Deduplicate ordered routes, keep probes and route ends, and share the remaining 2,000 slots proportionally. */
export function routeSpatialPoints(routes: RouteSpatialPoint[][], probeNodes: readonly string[], limit: number = 2000): RouteSpatialPoint[] {
  const seen = new Set<string>()
  const unique = routes.map(route => route.filter(point => {
    if (point.node === '0' || seen.has(point.node)) return false
    seen.add(point.node)
    return true
  })).filter(route => route.length)
  const required = new Set(probeNodes)
  for (const route of unique) {
    required.add(route[0].node)
    required.add(route.at(-1)!.node)
  }
  const kept = unique.flat().filter(point => required.has(point.node))
  if (kept.length > limit) fail('simulation_scope', `Spatial probe and route endpoints exceed the ${limit}-point limit`)
  const candidates = unique.map(route => route.filter(point => !required.has(point.node)))
  let remaining = limit - kept.length
  let total = candidates.reduce((sum, route) => sum + route.length, 0)
  for (const route of candidates) {
    const count = Math.min(route.length, Math.round(remaining * route.length / Math.max(total, 1)))
    for (const index of sampleIndices(route.length, count)) required.add(route[index].node)
    remaining -= count
    total -= route.length
  }
  return unique.flat().filter(point => required.has(point.node))
}

/** Decimate actual native samples on a shared time grid, leaving probe vectors at full resolution. */
export function routeSpatialWaveform(points: RouteSpatialPoint[], vectors: readonly SpiceVector[]): RouteSpatialWaveform {
  const values = new Map(vectors.map(vector => [vector.name.toLowerCase(), vector.values]))
  const times = values.get('time')
  if (!times) return fail('simulation_probe', 'Missing ngspice time vector')
  if (times.some((time, i) => !Number.isFinite(time) || i > 0 && time < times[i - 1])) fail('simulation_probe', 'Expected increasing finite actual solver timestamps')
  const unique = times.flatMap((time, i) => i < times.length - 1 && time === times[i + 1] ? [] : [i])
  const indices = sampleIndices(unique.length, 1000).map(index => unique[index])
  const volts = points.map(point => {
    const vector = values.get(`v(${point.node.toLowerCase()})`)
    if (!vector) return fail('simulation_probe', `Missing ngspice vector v(${point.node})`)
    if (vector.length !== times.length || vector.some(value => !Number.isFinite(value))) fail('simulation_probe', `Incomplete finite ngspice vector v(${point.node})`)
    return indices.map(index => vector[index])
  })
  return { points, timeSeconds: indices.map(index => times[index]), volts }
}

/** Shared browser grid retains bucket ends and each logical probe's extrema, including differential peaks. */
function probeSampleIndices(indices: number[], vectors: readonly SpiceVector[], pairs: string[][]): number[] {
  if (indices.length <= 5000) return indices
  const values = new Map(vectors.map(vector => [vector.name, vector.values]))
  /** Ground is implicit; every other declared probe terminal must have a native vector. */
  const node = (name: string): number[] | undefined => {
    if (name === '0') return undefined
    const vector = values.get(`v(${name.toLowerCase()})`)
    if (!vector) fail('simulation_probe', `Missing ngspice vector v(${name})`)
    return vector
  }
  const probes = pairs.map(pair => pair.map(node))
  const size = Math.ceil(indices.length / Math.max(1, Math.floor(5000 / (2 + 4 * probes.length))))
  const kept = new Set<number>()
  for (let start = 0; start < indices.length; start += size) {
    const end = Math.min(indices.length, start + size)
    kept.add(indices[start])
    kept.add(indices[end - 1])
    for (const [signal, reference] of probes) {
      let low = indices[start]
      let high = low
      let lastLow = low
      let lastHigh = high
      let minimum = (signal?.[low] ?? 0) - (reference?.[low] ?? 0)
      let maximum = minimum
      for (let i = start + 1; i < end; i++) {
        const index = indices[i]
        const value = (signal?.[index] ?? 0) - (reference?.[index] ?? 0)
        if (value < minimum) {
          minimum = value
          low = index
          lastLow = index
        } else if (value === minimum) lastLow = index
        if (value > maximum) {
          maximum = value
          high = index
          lastHigh = index
        } else if (value === maximum) lastHigh = index
      }
      kept.add(low)
      kept.add(high)
      kept.add(lastLow)
      kept.add(lastHigh)
    }
  }
  // Fill spare slots evenly with native samples after reserving every envelope extremum.
  const remaining = indices.filter(index => !kept.has(index))
  for (const index of sampleIndices(remaining.length, 5000 - kept.size)) kept.add(remaining[index])
  return [...kept].sort((a, b) => a - b)
}

/** Browser transport bounds probe envelopes and spatial ASCII; direct Node captures keep every native sample. */
export function compactRouteVectors(deck: string, raw: string): Record<string, string> {
  const declaration = /^\* Routed probe nodes: (.+)$/m.exec(deck)
  if (!declaration) return { 'waveform.raw': raw }
  const probes = new Set(declaration[1].split(' ').map(node => `v(${node.toLowerCase()})`))
  const vectors = parseSpiceVectors(raw)
  const times = vectors.find(vector => vector.name === 'time')
  if (!times) return fail('simulation_probe', 'Missing ngspice time vector')
  const unique = times.values.flatMap((time, i) => i < times.values.length - 1 && time === times.values[i + 1] ? [] : [i])
  const indices = sampleIndices(unique.length, 1000).map(index => unique[index])
  const pairs = /^\* Routed probe pairs: (.+)$/m.exec(deck)?.[1].split(' ').map(pair => pair.split(',')) ?? declaration[1].split(' ').map(node => [node, '0'])
  const probeIndices = probeSampleIndices(unique, vectors, pairs)
  return {
    'waveform.raw': formatSpiceVectors(vectors.filter(vector => vector.name === 'time' || probes.has(vector.name)).map(vector => ({ ...vector, values: probeIndices.map(index => vector.values[index]) }))),
    'spatial.raw': formatSpiceVectors(vectors.filter(vector => vector.name === 'time' || vector.type === 'voltage').map(vector => ({ ...vector, values: indices.map(index => vector.values[index]) }))),
    'native-waveform.sha256': sha256(raw),
  }
}
