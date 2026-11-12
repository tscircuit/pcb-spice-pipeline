import * as THREE from 'three'
import { boardPosition, boardFrame, resolveRouteVias, type BoardStackup, type CircuitJson } from '../../src/board'
import { segment, label } from './primitives'

export interface CopperRoute {
  trace: string
  net: string
  layer: string
  a: [number, number]
  b: [number, number]
  width: number
}

/** Read every trace, independently of selected-net scope; explicit vias retain layer changes. */
export function copperRoutes(circuit: CircuitJson): CopperRoute[] {
  return circuit
    .filter((record) => record.type === 'pcb_trace')
    .flatMap((trace) => {
      const route = resolveRouteVias(circuit, trace)
      const source = circuit.find((record) => record.type === 'source_trace' && record.source_trace_id === trace.source_trace_id)
      const net =
        source?.type === 'source_trace'
          ? (source.connected_source_net_ids?.[0] ?? source.source_trace_id)
          : (trace.source_trace_id ?? trace.pcb_trace_id)
      return route.flatMap((b, i) => {
        if (!i || b.route_type !== 'wire') return []
        const a = route[i - 1]
        const layer = a.route_type === 'via' ? a.to_layer : a.layer
        return [
          { trace: trace.pcb_trace_id, net, layer, a: [a.x, a.y] as [number, number], b: [b.x, b.y] as [number, number], width: b.width },
        ]
      })
    })
}

/** Draw all copper layers and pours, including cutouts, at physical stackup depths. */
export function fullCopper(circuit: CircuitJson, stack: BoardStackup): THREE.Group {
  const group = new THREE.Group()
  group.name = 'complete-board-copper'
  for (const route of copperRoutes(circuit))
    segment(group, boardPosition(stack, ...route.a, route.layer), boardPosition(stack, ...route.b, route.layer), route.width, '#c58b43')
  for (const pour of circuit.filter((record) => record.type === 'pcb_copper_pour')) {
    const shape =
      pour.shape === 'brep'
        ? new THREE.Shape(pour.brep_shape.outer_ring.vertices.map((point) => new THREE.Vector2(point.x, point.y)))
        : pour.shape === 'polygon'
          ? new THREE.Shape(pour.points.map((point) => new THREE.Vector2(point.x, point.y)))
          : new THREE.Shape([
              new THREE.Vector2(-pour.width / 2, -pour.height / 2),
              new THREE.Vector2(pour.width / 2, -pour.height / 2),
              new THREE.Vector2(pour.width / 2, pour.height / 2),
              new THREE.Vector2(-pour.width / 2, pour.height / 2),
            ])
    if (pour.shape === 'brep')
      for (const ring of pour.brep_shape.inner_rings)
        shape.holes.push(new THREE.Path(ring.vertices.map((point) => new THREE.Vector2(point.x, point.y))))
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: '#a88b52', side: THREE.DoubleSide, transparent: true, opacity: 0.2, depthWrite: false }),
    )
    mesh.position.set(
      ...boardPosition(stack, pour.shape === 'rect' ? pour.center.x : 0, pour.shape === 'rect' ? pour.center.y : 0, pour.layer),
    )
    if (pour.shape === 'rect') mesh.rotation.z = ((pour.rotation ?? 0) * Math.PI) / 180
    mesh.frustumCulled = false
    group.add(mesh)
  }
  for (const via of circuit.filter((record) => record.type === 'pcb_via')) {
    const layers = via.layers.filter((layer) => stack.copperLayers.some((copper) => copper.name === layer))
    if (!layers.length) continue
    segment(
      group,
      boardPosition(stack, via.x, via.y, layers[0]),
      boardPosition(stack, via.x, via.y, layers.at(-1)!),
      via.outer_diameter,
      '#d9a44b',
      0.65,
    )
  }
  for (const trace of circuit.filter((record) => record.type === 'pcb_trace')) {
    for (const via of resolveRouteVias(circuit, trace).filter((point) => point.route_type === 'via')) {
      segment(
        group,
        boardPosition(stack, via.x, via.y, via.from_layer),
        boardPosition(stack, via.x, via.y, via.to_layer),
        via.outer_diameter ?? (via.hole_diameter ?? 0.2) + 2 * (stack.viaPlatingMm ?? 0.018),
        '#d9a44b',
        0.65,
      )
    }
  }
  for (const pad of circuit.filter((record) => record.type === 'pcb_smtpad')) {
    const shape =
      pad.shape === 'polygon'
        ? new THREE.ShapeGeometry(new THREE.Shape(pad.points.map((point) => new THREE.Vector2(point.x, point.y))))
        : pad.shape === 'circle'
          ? new THREE.CircleGeometry(pad.radius, 16)
          : padShape(pad.width, pad.height, 'radius' in pad ? pad.radius : 'corner_radius' in pad ? (pad.corner_radius ?? 0) : 0)
    const mesh = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: '#d4ad62', side: THREE.DoubleSide }))
    mesh.position.set(...boardPosition(stack, 'x' in pad ? pad.x : 0, 'y' in pad ? pad.y : 0, pad.layer))
    mesh.rotation.z = (('ccw_rotation' in pad ? (pad.ccw_rotation ?? 0) : 0) * Math.PI) / 180
    mesh.frustumCulled = false
    group.add(mesh)
  }
  // Imported boards may have no CAD models. Keep every such component physically visible and identify the limitation.
  const frame = boardFrame(stack)
  for (const component of circuit.filter((record) => record.type === 'pcb_component')) {
    if (circuit.some((record) => record.type === 'cad_component' && record.pcb_component_id === component.pcb_component_id)) continue
    const height = 0.8
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(component.width, 0.4), Math.max(component.height, 0.4), height),
      new THREE.MeshBasicMaterial({ color: '#667085', wireframe: true }),
    )
    mesh.position.set(
      component.center.x,
      component.center.y,
      (component.layer === 'bottom' ? -1 : 1) * ((frame.top - frame.bottom) / 2 + height / 2),
    )
    mesh.rotation.z = (component.rotation * Math.PI) / 180
    mesh.frustumCulled = false
    group.add(mesh)
    const source = circuit.find(
      (record) => record.type === 'source_component' && record.source_component_id === component.source_component_id,
    )
    label(
      group,
      [mesh.position.x, mesh.position.y, mesh.position.z + height],
      `${source?.type === 'source_component' ? source.name : component.pcb_component_id} · no CAD`,
      0.6,
    )
  }
  return group
}

/** Preserve rounded pad copper at its physical size; rotation is applied by the owning mesh. */
function padShape(width: number, height: number, radius: number): THREE.ShapeGeometry {
  const r = Math.min(radius, width / 2, height / 2)
  const x = width / 2 - r
  const y = height / 2 - r
  const shape = new THREE.Shape()
  shape.absarc(x, y, r, 0, Math.PI / 2, false)
  shape.absarc(-x, y, r, Math.PI / 2, Math.PI, false)
  shape.absarc(-x, -y, r, Math.PI, Math.PI * 1.5, false)
  shape.absarc(x, -y, r, Math.PI * 1.5, Math.PI * 2, false)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}
