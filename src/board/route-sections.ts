import { unionRouteWires } from './route-union'
import { simplifyRouteWires } from './route-simplify'
import { polygonContains } from './geometry/polygon'
import { resolveRouteVias } from './geometry/ports'
import { stackupFromCircuitJson, type BoardStackup } from './stackup'
import type { CircuitJson } from './schema'
import type { CopperScope } from './geometry/scope'

export type RouteXY = [number, number]
export interface RouteWire {
  id: number; trace: string; source: string; layer: string; width: number
  joins?: { from: RouteXY; to: RouteXY; source: string; trace: string }[]
  aPort?: boolean; bPort?: boolean
  a: RouteXY; b: RouteXY; u: RouteXY; start: number; end: number; transverse: number
}
export interface RouteReference { id: string; net: string; layer: string; z: number; lateralGapMm?: number }
export interface RouteSlice {
  wires: RouteWire[]; start: number; end: number; references: RouteReference[]
}
export interface SectionGeometry {
  viaContacts: { trace: string; layer: string; point: RouteXY }[]
  stack: BoardStackup; wires: RouteWire[]; slices: RouteSlice[]
  pours: { id: string; net: string; layer: string; polygon: RouteXY[][] }[]
  warnings: string[]
}

/** Canonical projection in mm; route direction is retained in the physical endpoints. */
export function routePosition(wire: RouteWire, position: number): RouteXY {
  return [wire.u[0] * position - wire.u[1] * wire.transverse, wire.u[1] * position + wire.u[0] * wire.transverse]
}

/** Local frame at actual routed copper, including via-in-pad contacts without a planar segment. */
export function routeContactFrame(geometry: SectionGeometry, scope: CopperScope, layer: string, point: RouteXY): RouteWire | undefined {
  const direct = geometry.wires.find(wire => !scope.nonReferenceRailTraceIds.includes(wire.trace) && wire.layer === layer && [wire.a, wire.b, ...(wire.joins?.map(join => join.from) ?? [])].some(p => Math.hypot(p[0] - point[0], p[1] - point[1]) < 1e-5))
  if (direct) return direct
  const contact = geometry.viaContacts.find(contact => !scope.nonReferenceRailTraceIds.includes(contact.trace) && contact.layer === layer && Math.hypot(contact.point[0] - point[0], contact.point[1] - point[1]) < 1e-5)
  const wire = contact && geometry.wires.find(wire => wire.trace === contact.trace)
  return wire ? { ...wire, layer } : undefined
}

/** Nearest actual pour surface in each vertical direction, including intervening power copper. */
export function routeReferences(geometry: Pick<SectionGeometry, 'stack' | 'pours'>, wire: RouteWire, position: number): RouteReference[] {
  const point = routePosition(wire, position)
  const signal = geometry.stack.copperLayers.find(layer => layer.name === wire.layer)!
  const candidates = geometry.pours.filter(pour => pour.layer !== wire.layer && polygonContains(point, pour.polygon)).map(pour => {
    const layer = geometry.stack.copperLayers.find(layer => layer.name === pour.layer)!
    return { id: pour.id, net: pour.net, layer: pour.layer, z: layer.zMinMm > signal.zMaxMm ? layer.zMinMm : layer.zMaxMm }
  })
  const actual = [candidates.filter(plane => plane.z <= signal.zMinMm).sort((a, b) => b.z - a.z)[0],
    candidates.filter(plane => plane.z >= signal.zMaxMm).sort((a, b) => a.z - b.z)[0]].filter((plane): plane is RouteReference => !!plane)
  if (actual.length) return actual
  // A local aperture can remove all vertically intersecting copper. Use the nearest *actual* edge,
  // displaced by the edge distance, as an explicit quasi-static fringing/return-detour estimate.
  const edges = geometry.pours.filter(pour => pour.layer !== wire.layer).map(pour => {
    const gap = Math.min(...pour.polygon.flatMap(ring => ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
    })))
    const layer = geometry.stack.copperLayers.find(layer => layer.name === pour.layer)!
    const above = layer.zMinMm > signal.zMaxMm
    const surface = above ? layer.zMinMm : layer.zMaxMm
    const face = above ? signal.zMaxMm : signal.zMinMm
    const distance = Math.hypot(surface - face, gap)
    return { id: pour.id, net: pour.net, layer: pour.layer, z: face + (above ? distance : -distance), lateralGapMm: gap, distance }
  }).sort((a, b) => a.distance - b.distance)
  return edges.length && edges[0].distance < 2 ? [edges[0]] : []
}

/** Centre-line intersections with every pour boundary/cutout; no sampling can jump over a narrow void. */
function referenceCuts(wire: RouteWire, geometry: SectionGeometry): number[] {
  const cuts: number[] = []
  for (const pour of geometry.pours) for (const ring of pour.polygon) for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const denominator = dx * wire.u[1] - dy * wire.u[0]
    if (Math.abs(denominator) < 1e-10) continue
    const t = (-wire.transverse - a[0] * wire.u[1] + a[1] * wire.u[0]) / denominator
    if (t > 0 && t < 1) {
      const s = (a[0] + t * dx) * wire.u[0] + (a[1] + t * dy) * wire.u[1]
      if (s > wire.start + 1e-7 && s < wire.end - 1e-7) cuts.push(s)
    }
  }
  return cuts
}

/** Sweep exact parallel directions, partitioning at route ends, widths, layers and actual pour holes. */
export function segmentRoutes(circuit: CircuitJson, scope: CopperScope): SectionGeometry {
  const geometry: SectionGeometry = { viaContacts: [], stack: stackupFromCircuitJson(circuit), wires: [], slices: [], pours: [], warnings: [] }
  geometry.pours = circuit.filter(record => record.type === 'pcb_copper_pour').flatMap(pour => {
    if (pour.shape !== 'brep') throw new Error(`${pour.pcb_copper_pour_id}: 2D route extraction needs polygonal pours`)
    return [{ id: pour.pcb_copper_pour_id, net: pour.source_net_id ?? 'unassociated', layer: pour.layer,
      polygon: [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings].map(ring => ring.vertices.map(p => [p.x, p.y] as RouteXY)) }]
  })
  // Rail traces are retained as AC-ground electrodes by the extraction caller; they need no longitudinal dynamics.
  for (const trace of circuit.filter(record => record.type === 'pcb_trace').filter(trace => scope.pcbTraceIds.includes(trace.pcb_trace_id))) {
    const route = resolveRouteVias(circuit, trace)
    for (const via of route.filter(point => point.route_type === 'via')) for (const layer of [via.from_layer, via.to_layer]) geometry.viaContacts.push({ trace: trace.pcb_trace_id, layer, point: [via.x, via.y] })
    for (const [i, b] of route.entries()) {
      if (!i || b.route_type !== 'wire') continue
      const a = route[i - 1]
      const layer = a.route_type === 'via' ? a.to_layer : a.layer
      if (layer !== b.layer) throw new Error(`${trace.pcb_trace_id}: layer changes require explicit vias`)
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length < 1e-7) continue
      if (b.start_width !== undefined || b.end_width !== undefined) throw new Error(`${trace.pcb_trace_id}: tapered routes need explicit width sections`)
      const direction = b.x - a.x < -1e-9 || (Math.abs(b.x - a.x) < 1e-9 && b.y < a.y) ? -1 : 1
      const u: RouteXY = [direction * (b.x - a.x) / length, direction * (b.y - a.y) / length]
      const first = a.x * u[0] + a.y * u[1]
      const last = b.x * u[0] + b.y * u[1]
      geometry.wires.push({ id: geometry.wires.length, trace: trace.pcb_trace_id, source: trace.source_trace_id!, layer, width: b.width,
        a: [a.x, a.y], b: [b.x, b.y], u, start: Math.min(first, last), end: Math.max(first, last), transverse: -a.x * u[1] + a.y * u[0] })
    }
  }
  const simplified = simplifyRouteWires(geometry.wires, .001)
  geometry.warnings.push(`Curved route tessellation reduced with 0.001 mm chord tolerance: ${geometry.wires.length} to ${simplified.wires.length} wires; total length ${simplified.originalLengthMm} to ${simplified.simplifiedLengthMm} mm. Original board bytes unchanged.`)
  geometry.wires = unionRouteWires(simplified.wires, circuit)
  geometry.warnings.push('Overlapping parallel same-net copper is unioned into its exact transverse rectangle, split at patch ends. Lateral joins are equipotential breakout approximations; lateral spreading R/L and edge fringing are omitted. Original endpoints and joins are recorded.')
  const ports = circuit.filter(record => record.type === 'pcb_port')
  for (const wire of geometry.wires) {
    wire.aPort = ports.some(port => port.layers.includes(wire.layer as typeof port.layers[number]) && Math.hypot(port.x - wire.a[0], port.y - wire.a[1]) < 1e-5)
    wire.bPort = ports.some(port => port.layers.includes(wire.layer as typeof port.layers[number]) && Math.hypot(port.x - wire.b[0], port.y - wire.b[1]) < 1e-5)
  }
  const groups = new Map<string, RouteWire[]>()
  for (const wire of geometry.wires) {
    const key = wire.u.map(n => n.toFixed(7)).join(',')
    groups.set(key, [...groups.get(key) ?? [], wire])
  }
  for (const wires of groups.values()) {
    const cuts = [...new Set(wires.flatMap(wire => [wire.start, wire.end, ...referenceCuts(wire, geometry)]).map(s => Number(s.toFixed(7))))].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1]
      const end = cuts[i]
      if (end - start < 1e-6) continue
      const middle = (start + end) / 2
      const active = wires.filter(wire => wire.start < middle && wire.end > middle)
      const regions = new Map<string, { wires: RouteWire[]; references: RouteReference[] }>()
      for (const wire of active) {
        const references = routeReferences(geometry, wire, middle)
        if (!references.length) {
          if (scope.nonReferenceRailTraceIds.includes(wire.trace)) continue
          throw new Error(`${wire.trace} ${wire.layer} at ${routePosition(wire, middle)}: no actual reference pour`)
        }
        const key = references.map(plane => `${plane.layer}:${plane.net}:${plane.z.toFixed(7)}`).join('/')
        const region = regions.get(key) ?? { wires: [], references }
        region.wires.push(wire)
        regions.set(key, region)
      }
      for (const region of regions.values()) {
        const ordered = region.wires.sort((a, b) => a.transverse - b.transverse)
        let group: RouteWire[] = []
        for (const wire of ordered) {
          if (group.length && wire.transverse - group.at(-1)!.transverse - (wire.width + group.at(-1)!.width) / 2 > scope.lateralDistanceMm) {
            if (group.some(wire => !scope.nonReferenceRailTraceIds.includes(wire.trace))) geometry.slices.push({ wires: group, start, end, references: region.references })
            group = []
          }
          group.push(wire)
        }
        if (group.length) if (group.some(wire => !scope.nonReferenceRailTraceIds.includes(wire.trace))) geometry.slices.push({ wires: group, start, end, references: region.references })
      }
    }
  }
  const merged: RouteSlice[] = []
  const previous = new Map<string, RouteSlice>()
  for (const slice of geometry.slices) {
    const key = JSON.stringify([slice.wires.map(wire => wire.id), slice.references])
    const last = previous.get(key)
    if (last && Math.abs(last.end - slice.start) < 1e-6) last.end = slice.end
    else {
      merged.push(slice)
      previous.set(key, slice)
    }
  }
  geometry.slices = merged
  geometry.warnings.push('Reference boundaries use centre-line polygon intersections; lateral fringing across plane edges/voids uses a local infinite-plane approximation, with no 3D edge-field accuracy claim.',
    'Where all vertical references are void, the nearest actual pour edge within 2 mm is replaced by a surface at hypotenuse(vertical gap, lateral edge distance); lateralGapMm marks every such approximation.',
    'Different parallel directions are separate sweeps; oblique encounters receive a bounded electrostatic lumped correction, with magnetic oblique coupling omitted explicitly.')
  return geometry
}
