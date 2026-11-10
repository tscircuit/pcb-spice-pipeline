import { connectedSourceIds, resolveRouteVias, routeReferences, routeContactFrame, type CircuitJson, type CopperScope, type SectionGeometry, type RouteWire, type RouteXY, type RouteReference } from '../board'

export interface RouteTransition { kind: string; id: string; inductanceH?: number; capacitanceF?: number; [key: string]: unknown }
export interface RouteTransitions { lines: string[]; records: RouteTransition[]; warnings: string[] }

/** Regularized TI short via approximation, h/d in mm, result H; the original uses inches and 5.08 nH. */
export function barrelInductance(height: number, diameter: number): number {
  return .2e-9 * height * (Math.log(1 + 4 * height / diameter) + 1)
}

/** Coaxial short open stub, with explicit assumed clearance diameter when aperture data are absent. */
export function barrelCapacitance(height: number, diameter: number, antipad: number, er: number): number {
  return 2 * Math.PI * 8.8541878128e-12 * er * height / 1000 / Math.log(antipad / diameter)
}

/** Actual pad copper area; unsupported custom polygons fail instead of disappearing. */
function padArea(pad: Extract<CircuitJson[number], { type: 'pcb_smtpad' }>): number {
  if (pad.shape === 'circle') return Math.PI * pad.radius ** 2
  if (pad.shape === 'rect') return pad.width * pad.height
  if (pad.shape === 'polygon') return Math.abs(pad.points.reduce((sum, p, i) => {
    const next = pad.points[(i + 1) % pad.points.length]
    return sum + p.x * next.y - next.x * p.y
  }, 0)) / 2
  throw new Error(`${pad.pcb_smtpad_id}: unsupported ${pad.shape} pad area`)
}

/** Lumped barrels/stubs, actual pad areas and nearest physical GND-via return-loop estimates. */
export function routeTransitions(circuit: CircuitJson, scope: CopperScope, geometry: SectionGeometry, endpoint: (wire: RouteWire, point: RouteXY) => string, groundPort: string): RouteTransitions {
  const output: RouteTransitions = { lines: [], records: [], warnings: [] }
  const layers = geometry.stack.copperLayers
  const ground = connectedSourceIds(circuit, groundPort)
  const sources = circuit.filter(record => record.type === 'source_trace')
  const groundVias = circuit.filter(record => record.type === 'pcb_via').filter(via => via.source_net_id && ground.has(via.source_net_id) || sources.some(source => source.source_trace_id === via.source_trace_id && [...source.connected_source_port_ids, ...source.connected_source_net_ids ?? []].some(id => ground.has(id))))
  /** Electrical node at a layer boundary, sharing the routed-wire graph. */
  const node = (wire: RouteWire, layer: string, point: RouteXY): string => endpoint({ ...wire, layer }, point)
  /** Copper layer mid-height in mm. */
  const height = (name: string): number => {
    const layer = layers.find(layer => layer.name === name)!
    return (layer.zMinMm + layer.zMaxMm) / 2
  }
  for (const trace of circuit.filter(record => record.type === 'pcb_trace').filter(trace => scope.pcbTraceIds.includes(trace.pcb_trace_id) && !scope.nonReferenceRailTraceIds.includes(trace.pcb_trace_id))) {
    const wire = geometry.wires.find(wire => wire.trace === trace.pcb_trace_id)
    if (!wire) continue
    const route = resolveRouteVias(circuit, trace)
    for (const via of route.filter(point => point.route_type === 'via')) {
      const physical = circuit.filter(record => record.type === 'pcb_via').find(record => (record.pcb_trace_id === trace.pcb_trace_id || record.source_trace_id === trace.source_trace_id) && Math.hypot(via.x - record.x, via.y - record.y) < 1e-5)
      if (!physical) throw new Error(`${trace.pcb_trace_id}: missing physical via barrel`)
      const tag = `VT${output.records.length}`
      const a = node(wire, via.from_layer, [via.x, via.y])
      const b = node(wire, via.to_layer, [via.x, via.y])
      const h = Math.abs(height(via.from_layer) - height(via.to_layer))
      const diameter = physical.hole_diameter + 2 * geometry.stack.viaPlatingMm!
      const antipad = physical.outer_diameter + .2
      const er = geometry.stack.relativePermittivity!
      const inductanceH = barrelInductance(h, diameter)
      const capacitanceF = barrelCapacitance(h, diameter, antipad, er)
      /** Reference immediately adjacent to this via, rather than the first section on its layer. */
      const adjacent = (name: string): RouteReference[] => geometry.slices.filter(slice => slice.wires.some(w => w.trace === wire.trace && w.layer === name)).map(slice => {
        const local = slice.wires.find(w => w.trace === wire.trace && w.layer === name)!
        const position = via.x * local.u[0] + via.y * local.u[1]
        const lateral = -via.x * local.u[1] + via.y * local.u[0] - local.transverse
        return { slice, distance: Math.hypot(lateral, Math.max(slice.start - position, position - slice.end, 0)) }
      }).sort((a, b) => a.distance - b.distance)[0]?.slice.references ?? routeReferences(geometry, { ...wire, layer: name, transverse: -via.x * wire.u[1] + via.y * wire.u[0] }, via.x * wire.u[0] + via.y * wire.u[1])
      const before = adjacent(via.from_layer)
      const after = adjacent(via.to_layer)
      const references = [...before, ...after]
      const fromHeight = before.length ? before.reduce((sum, ref) => sum + ref.z, 0) / before.length : height(via.from_layer)
      const toHeight = after.length ? after.reduce((sum, ref) => sum + ref.z, 0) / after.length : height(via.to_layer)
      const padAreaMm2 = Math.max(0, Math.PI * (physical.outer_diameter ** 2 - diameter ** 2) / 4)
      const padCapacitanceF = [before, after].map((refs, i) => {
        const layer = layers.find(layer => layer.name === (i ? via.to_layer : via.from_layer))!
        return refs.reduce((sum, ref) => {
          const gap = Math.min(Math.abs(ref.z - layer.zMinMm), Math.abs(ref.z - layer.zMaxMm))
          return sum + (gap > 1e-6 ? 8.8541878128e-12 * er * padAreaMm2 / gap / 1000 : 0)
        }, 0)
      })
      const referenceLayers = [...new Set(references.map(ref => ref.layer))]
      const candidates = groundVias.filter(v => {
        const depths = v.layers.map(height)
        return referenceLayers.every(name => height(name) >= Math.min(...depths) - 1e-6 && height(name) <= Math.max(...depths) + 1e-6)
      }).sort((x, y) => Math.hypot(x.x - via.x, x.y - via.y) - Math.hypot(y.x - via.x, y.y - via.y))
      const nearest = candidates[0]
      const distance = nearest ? Math.hypot(nearest.x - via.x, nearest.y - via.y) : 10
      const returnInductanceH = Math.abs(fromHeight - toHeight) < 1e-6 ? 0 : .2e-9 * Math.abs(fromHeight - toHeight) * Math.log(1 + 2 * distance / (nearest?.hole_diameter ?? .15))
      const resistance = h / 1000 / (5.8e7 * Math.PI * (diameter ** 2 - physical.hole_diameter ** 2) / 4e6)
      output.lines.push(`R${tag} ${a} ${tag}r ${resistance}`, `L${tag} ${tag}r ${b} ${inductanceH + returnInductanceH}`, `C${tag}a ${a} 0 ${capacitanceF / 2 + padCapacitanceF[0]}`, `C${tag}b ${b} 0 ${capacitanceF / 2 + padCapacitanceF[1]}`)
      const lo = Math.min(height(via.from_layer), height(via.to_layer))
      const hi = Math.max(height(via.from_layer), height(via.to_layer))
      const spans = physical.layers.map(height)
      const stubs = [Math.max(0, lo - Math.min(...spans)), Math.max(0, Math.max(...spans) - hi)]
      for (const [i, stub] of stubs.entries()) if (stub > 1e-6) {
        const tap = Math.abs(height(via.from_layer) - (i ? hi : lo)) < 1e-6 ? a : b
        output.lines.push(`L${tag}s${i} ${tap} ${tag}s${i} ${barrelInductance(stub, diameter)}`, `C${tag}s${i} ${tag}s${i} 0 ${barrelCapacitance(stub, diameter, antipad, er)}`)
      }
      output.records.push({ kind: 'via', id: physical.pcb_via_id, inductanceH, capacitanceF, returnInductanceH, nearestGroundVia: nearest?.pcb_via_id ?? null, groundViaDistanceMm: distance, stubsMm: stubs, antipadMm: antipad, references, resistanceOhm: resistance, padAreaMm2, padCapacitanceF })
      if (!nearest && returnInductanceH) output.warnings.push(`${physical.pcb_via_id}: no spanning ground stitch found; return-loop estimate uses explicit 10 mm spreading distance`)
      if (references.some(ref => !ground.has(ref.net))) output.warnings.push(`${physical.pcb_via_id}: reference includes a different-net power plane; ideal AC rail/reference assumption omits PDN impedance`)
    }
  }
  for (const port of circuit.filter(record => record.type === 'pcb_port')) {
    const pad = circuit.filter(record => record.type === 'pcb_smtpad').find(pad => pad.pcb_port_id === port.pcb_port_id)
    if (!pad) continue
    const wire = routeContactFrame(geometry, scope, pad.layer, [port.x, port.y])
    if (!wire) continue
    const position = port.x * wire.u[0] + port.y * wire.u[1]
    const references = routeReferences(geometry, { ...wire, transverse: -port.x * wire.u[1] + port.y * wire.u[0] }, position)
    const layer = layers.find(layer => layer.name === wire.layer)!
    const area = padArea(pad)
    const gap = Math.min(...references.map(plane => Math.min(Math.abs(plane.z - layer.zMinMm), Math.abs(plane.z - layer.zMaxMm))))
    if (!(area > 0 && gap > 0 && Number.isFinite(gap))) throw new Error(`${pad.pcb_smtpad_id}: invalid pad/reference geometry`)
    const capacitanceF = 8.8541878128e-12 * geometry.stack.relativePermittivity! * area / gap / 1000
    output.lines.push(`CPAD${output.records.length} ${endpoint(wire, [port.x, port.y])} 0 ${capacitanceF}`)
    output.records.push({ kind: 'pad', id: pad.pcb_smtpad_id, capacitanceF, areaMm2: area, gapMm: gap })
  }
  output.warnings.push('Via-to-via and via-to-trace mutual coupling is omitted; barrel models contain self L/C and a signal-referred return estimate.',
    'Via pads use connected-end annular parallel-plate capacitance; nonfunctional internal pads are unspecified and omitted. Antipad edge fringing is not resolved.',
    'Via antipads: outer pad diameter + 0.20 mm assumed; barrel coaxial C and short-open-stub LC are estimates, not 3D discontinuity extraction.',
    'Return-loop L is signal-referred at the via; ideal equipotential planes omit shared plane spreading resonances and PDN impedance.',
    'BGA/SMD pads use parallel-plate area capacitance; routed breakout wire R/L remains distributed. Pad fringing and current crowding are omitted.')
  return output
}
