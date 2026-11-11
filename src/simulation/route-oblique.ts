import { closestRoutePoints, routeCrossSection, solveCrossSection, type ExtractedRoutes, type RouteMaterials, type RouteFieldCache } from '../extraction'
import { type SectionGeometry, type CopperScope, type RouteWire, type RouteXY } from '../board'
import type { RouteLadder } from './route-ladder'

/** Bounded weak-coupling electrostatic correction for oblique encounters; no silent angular rejection. */
export function routeOblique(geometry: SectionGeometry, extracted: ExtractedRoutes, ladder: RouteLadder, scope: CopperScope, materials: RouteMaterials, panels: number = 12, shared?: RouteFieldCache): {
  lines: string[]; records: Record<string, unknown>[]; solveMilliseconds: number; solves: number
} {
  const lines: string[] = []
  const records: Record<string, unknown>[] = []
  if (shared && shared.panels !== panels) throw new Error('Field cache panel resolution disagrees with extraction')
  const cache = shared?.oblique ?? new Map<string, number>()
  let solveMilliseconds = 0
  const active = geometry.wires.filter(wire => ladder.wireNodes.has(wire.id))
  /** Nearest existing electrical ladder node; the spatial-error distance is recorded per encounter. */
  const nearest = (wire: RouteWire, point: RouteXY): { node: string; errorMm: number } => {
    const position = point[0] * wire.u[0] + point[1] * wire.u[1]
    const node = [...ladder.wireNodes.get(wire.id)!].sort((a, b) => Math.abs(a.position - position) - Math.abs(b.position - position))[0]
    return { node: node.node, errorMm: Math.abs(node.position - position) }
  }
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i]
    const b = active[j]
    if (a.source === b.source || (!scope.selectedPcbTraceIds.includes(a.trace) && !scope.selectedPcbTraceIds.includes(b.trace))) continue
    const sine = Math.abs(a.u[0] * b.u[1] - a.u[1] * b.u[0])
    if (sine < 1e-6) continue
    const near = closestRoutePoints(a.a, a.b, b.a, b.b)
    if (near.distance - (a.width + b.width) / 2 > scope.lateralDistanceMm) continue
    const layers = geometry.stack.copperLayers
    const la = layers.findIndex(layer => layer.name === a.layer)
    const lb = layers.findIndex(layer => layer.name === b.layer)
    if (Math.abs(la - lb) > 1) continue
    const position = near.first[0] * a.u[0] + near.first[1] * a.u[1]
    const slice = extracted.slices.find(slice => slice.wires.includes(a) && position >= slice.start - 1e-6 && position <= slice.end + 1e-6)
    if (!slice) continue
    if (a.layer === b.layer && near.distance < (a.width + b.width) / 2 + 1e-6) {
      records.push({ wires: [a.id, b.id], policy: 'touching endpoint/bend copper: no parallel-strip substitution', distanceMm: near.distance })
      continue
    }
    const synthetic = { ...slice, wires: [{ ...a, transverse: 0 }, { ...b, transverse: near.distance }] }
    const section = routeCrossSection(geometry, synthetic, materials)
    if (section.conductors.some(conductor => section.planes.some(plane => plane.zMm >= conductor.zMm - 1e-9 && plane.zMm <= conductor.zMm + conductor.thicknessMm + 1e-9))) {
      records.push({ wires: [a.id, b.id], policy: 'intervening local reference shields oblique surrogate; finite plane-edge/aperture fringing omitted', references: slice.references, distanceMm: near.distance })
      continue
    }
    // Quantisation is explicit and limited to 1 um transverse spacing, below route-file precision.
    section.conductors[1].xMm = Math.ceil(section.conductors[1].xMm * 1000) / 1000
    const key = JSON.stringify(section)
    let capacitancePerM = cache.get(key)
    if (capacitancePerM === undefined) {
      const start = performance.now()
      try {
        capacitancePerM = Math.max(0, -solveCrossSection(section, { panelsPerEdge: panels }).C[0][1])
      } catch (error) {
        throw Object.assign(error as Error, { routeSection: section, wires: [a, b], obliqueSolves: cache.size, solveMilliseconds: extracted.solveMilliseconds + solveMilliseconds })
      }
      solveMilliseconds += performance.now() - start
      cache.set(key, capacitancePerM)
    }
    const referenceGap = Math.min(...slice.references.map(ref => Math.abs(ref.z - (layers[la].zMaxMm + layers[la].zMinMm) / 2)))
    const lengthMm = Math.min(a.end - a.start, b.end - b.start, 2 * referenceGap / sine)
    const first = nearest(a, near.first)
    const second = nearest(b, near.second)
    const capacitanceF = capacitancePerM * lengthMm / 1000
    if (first.node !== second.node && capacitanceF > 1e-23) lines.push(`COB${records.length} ${first.node} ${second.node} ${capacitanceF}`)
    records.push({ wires: [a.id, b.id], policy: 'local parallel electrostatic surrogate; magnetic term omitted', angleSine: sine, distanceMm: near.distance, lengthMm, capacitanceF, nodePlacementErrorMm: [first.errorMm, second.errorMm] })
  }
  return { lines, records, solveMilliseconds, solves: cache.size }
}
