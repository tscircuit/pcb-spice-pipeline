import type { CircuitJson } from '../schema'
import type { BoardStackup } from '../stackup'
import { connectedSourceIds } from '../connectivity'
import { fail } from '../diagnostics'
import type { CrossSection, ReferenceVia } from './types'

/** Classifies stitching vias by electrical connectivity, including standalone source_via records. */
export function referenceVias(circuit: CircuitJson, stack: BoardStackup, ground: Set<string>, rails: Set<string>, selected: Set<string>): ReferenceVia[] {
  return circuit.filter(r => r.type === 'pcb_via').filter(r => !selected.has(r.pcb_trace_id ?? '')).map(via => {
    const trace = circuit.find(r => r.type === 'pcb_trace' && r.pcb_trace_id === via.pcb_trace_id)
    const source = circuit.find(r => r.type === 'source_trace' && r.source_trace_id === (trace?.type === 'pcb_trace' ? trace.source_trace_id : ''))
    const key = Reflect.get(via, 'subcircuit_connectivity_map_key')
    const identity = circuit.find(r => (r.type === 'source_net' || r.type === 'source_port') && key && Reflect.get(r, 'subcircuit_connectivity_map_key') === key)
    const ids = source?.type === 'source_trace' ? [...source.connected_source_port_ids, ...(source.connected_source_net_ids ?? [])] : identity?.type === 'source_net' ? [identity.source_net_id] : identity?.type === 'source_port' ? [identity.source_port_id] : []
    const seed = ids.find(id => ground.has(id) || rails.has(id))
    if (!seed) fail('reference_via', `${via.pcb_via_id}: via is neither a bound route nor an electrically identified reference-net stitch`)
    const layers = stack.copperLayers.filter(l => via.layers.includes(l.name as never))
    const plating = stack.viaPlatingMm
    if (layers.length !== via.layers.length || layers.length < 2 || !plating || ![plating, via.x, via.y, via.hole_diameter, via.outer_diameter].every(Number.isFinite) || plating <= 0 || via.hole_diameter <= 0 || via.outer_diameter <= via.hole_diameter + 2 * plating) fail('via_geometry', `${via.pcb_via_id}: physical layer span, pad, hole and plating required`)
    if (layers.some(l => l.conductivitySm !== layers[0].conductivitySm)) fail('via_geometry', `${via.pcb_via_id}: mixed conductor materials do not identify the barrel plating conductivity`)
    return { id: via.pcb_via_id, physicalNet: ground.has(seed) ? 'GROUND' : [...connectedSourceIds(circuit, seed)].sort()[0], x: via.x, y: via.y,
      holeMm: via.hole_diameter, padMm: via.outer_diameter, platingMm: plating, layers: layers.map(l => l.name), pads: layers.map(l => ({ zMin: l.zMinMm, zMax: l.zMaxMm })),
      zMin: Math.min(...layers.map(l => l.zMinMm)), zMax: Math.max(...layers.map(l => l.zMaxMm)), conductivitySm: layers[0].conductivitySm }
  })
}
/** Cuts at every circular pad, barrel and drill tangent, plus the central cross-section. */
export function viaCuts(via: ReferenceVia, dx: number, dy: number): number[] {
  const center = via.x * dx + via.y * dy
  return [0, ...[via.holeMm / 2, via.holeMm / 2 + via.platingMm, via.padMm / 2].flatMap(r => [-r, r])].map(v => center + v)
}
/** Adds the exact circular chord at this local quasi-TEM slice, including its drilled air void.
 * Existing pour void polygons retain their actual antipad clearances; no antipad is invented.
 */
export function sliceVias(slice: CrossSection, vias: ReferenceVia[], dx: number, dy: number, t: number): void {
  for (const via of vias) {
    const offset = t - via.x * dx - via.y * dy
    const center = -via.x * dy + via.y * dx
    /** Half-width of the circular cross-section at this longitudinal position. */
    const chord = (radius: number): number => Math.sqrt(Math.max(0, radius ** 2 - offset ** 2))
    const hole = chord(via.holeMm / 2)
    const barrel = chord(via.holeMm / 2 + via.platingMm)
    const pad = chord(via.padMm / 2)
    if (!pad) continue
    if (hole) slice.conductors = slice.conductors.flatMap(c => {
      if (c.zMax <= via.zMin || c.zMin >= via.zMax || c.xMax <= center - hole || c.xMin >= center + hole) return [c]
      if (c.physicalNet !== via.physicalNet) fail('conductor_overlap', `${via.id}: drill intersects ${c.id} on another net`)
      return [{ ...c, xMax: Math.min(c.xMax, center - hole) }, { ...c, xMin: Math.max(c.xMin, center + hole) }].filter(p => p.xMax > p.xMin)
    })
    if (hole) slice.dielectrics = slice.dielectrics.flatMap(d => {
      if (d.zMax <= via.zMin || d.zMin >= via.zMax || d.xMax <= center - hole || d.xMin >= center + hole) return [d]
      return [
        { ...d, xMax: Math.min(d.xMax, center - hole) },
        { ...d, xMin: Math.max(d.xMin, center + hole) },
      ].filter(p => p.xMax > p.xMin)
    })
    /** Hollow metal is represented by its two chord intervals, with equipotential group -1. */
    const metal = (outer: number, zMin: number, zMax: number, penetrationMm: number): void => {
      if (!outer) return
      for (const [lo, hi] of hole ? [[-outer, -hole], [hole, outer]] : [[-outer, outer]]) if (hi > lo) slice.conductors.push({ id: via.id, group: -1, physicalNet: via.physicalNet,
        xMin: center + lo, xMax: center + hi, zMin, zMax, penetrationMm, conductivitySm: via.conductivitySm })
    }
    metal(barrel, via.zMin, via.zMax, via.platingMm)
    for (const span of via.pads) metal(pad, span.zMin, span.zMax, span.zMax - span.zMin)
  }
}
