import { numerics } from '../../kernel'
import type { CircuitJson } from '../schema'
import { fail } from '../diagnostics'

/** Measures an actual circular ground-pour void; a slot, split edge or missing hole is never guessed circular. */
export function antipadDiameter(circuit: CircuitJson, via: Extract<CircuitJson[number],{type:'pcb_via'}>, ground: Set<string>): number {
  const explicit: unknown = Reflect.get(via,'antipad_diameter')
  if (typeof explicit === 'number' && explicit > via.outer_diameter) return explicit
  const diameters: number[] = []
  for (const pour of circuit.filter(r=>r.type==='pcb_copper_pour')) {
    if (!ground.has(pour.source_net_id??'') || pour.shape!=='brep') continue
    for (const ring of pour.brep_shape.inner_rings) {
      const distances = ring.vertices.map(p=>Math.hypot(p.x-via.x,p.y-via.y))
      const radius = distances.reduce((s,r)=>s+r,0)/distances.length
      if (radius > via.outer_diameter/2 && Math.max(...distances)-Math.min(...distances) < radius*numerics.meshRelativeChange) diameters.push(2*radius)
    }
  }
  if (!diameters.length) fail('via_antipad',`${via.pcb_via_id}: record a circular antipad or provide its actual circular ground-pour void; a split-plane edge is insufficient`)
  if (Math.max(...diameters)/Math.min(...diameters)-1 > numerics.meshRelativeChange) fail('via_antipad','Different antipad sizes require a layered via model')
  return diameters[0]
}
