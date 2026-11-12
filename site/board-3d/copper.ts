import * as THREE from 'three'
import { boardPosition, boardFrame, boardRouteSegments, stackupFromCircuitJson, resolveRouteVias, type BoardStackup, type CircuitJson } from '../../src/board'
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
  return boardRouteSegments(circuit, stackupFromCircuitJson(circuit)).filter(route => route.kind === 'wire').map(route => {
    const trace = circuit.find(record => record.type === 'pcb_trace' && record.pcb_trace_id === route.trace)!
    const source = trace.type === 'pcb_trace' && circuit.find(record => record.type === 'source_trace' && record.source_trace_id === trace.source_trace_id)
    const net = source && source.type === 'source_trace' ? source.connected_source_net_ids?.[0] ?? source.source_trace_id : route.trace
    return { trace: route.trace, net, layer: route.layer, a: [route.a[0], route.a[1]], b: [route.b[0], route.b[1]], width: route.width }
  })
}

/** Draw all copper layers and pours, including cutouts, at physical stackup depths. */
export function fullCopper(circuit: CircuitJson, stack: BoardStackup): THREE.Group {
  const group = new THREE.Group()
  group.name = 'complete-board-copper'
  for (const route of boardRouteSegments(circuit, stack).filter((route) => route.kind === 'wire')) {
    const delta = new THREE.Vector3(...route.b).sub(new THREE.Vector3(...route.a))
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(delta.length(), route.width, route.thickness),
      new THREE.MeshStandardMaterial({ color: '#c58b43', roughness: 0.4, metalness: 0.5 }),
    )
    mesh.position.set(...(route.a.map((value, axis) => (value + route.b[axis]) / 2) as [number, number, number]))
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), delta.normalize())
    mesh.frustumCulled = false
    mesh.userData.kind = 'copper'
    mesh.userData.layer = route.layer
    group.add(mesh)
  }
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
      new THREE.ExtrudeGeometry(shape, {
        depth:
          stack.copperLayers.find((layer) => layer.name === pour.layer)!.zMaxMm -
          stack.copperLayers.find((layer) => layer.name === pour.layer)!.zMinMm,
        bevelEnabled: false,
      }),
      new THREE.MeshBasicMaterial({ color: '#a88b52', side: THREE.DoubleSide, transparent: true, opacity: 0.2, depthWrite: false }),
    )
    mesh.position.set(
      ...boardPosition(stack, pour.shape === 'rect' ? pour.center.x : 0, pour.shape === 'rect' ? pour.center.y : 0, pour.layer),
    )
    mesh.position.z -=
      (stack.copperLayers.find((layer) => layer.name === pour.layer)!.zMaxMm -
        stack.copperLayers.find((layer) => layer.name === pour.layer)!.zMinMm) /
      2
    if (pour.shape === 'rect') mesh.rotation.z = ((pour.rotation ?? 0) * Math.PI) / 180
    mesh.frustumCulled = false
    group.add(mesh)
  }
  const vias = new Set<string>()
  /** Draw a plated annular barrel rather than an opaque solid cylinder. */
  const barrel = (x: number, y: number, first: string, last: string, hole: number, diameter: number): void => {
    const key = `${x}:${y}:${[first, last].sort().join(':')}`
    if (vias.has(key)) return
    vias.add(key)
    const low = Math.min(boardPosition(stack, x, y, first)[2], boardPosition(stack, x, y, last)[2])
    const high = Math.max(boardPosition(stack, x, y, first)[2], boardPosition(stack, x, y, last)[2])
    const ring = new THREE.Shape()
    ring.absarc(0, 0, hole / 2 + (stack.viaPlatingMm ?? 0.018), 0, Math.PI * 2, false)
    const bore = new THREE.Path()
    bore.absarc(0, 0, hole / 2, 0, Math.PI * 2, true)
    ring.holes.push(bore)
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(ring, { depth: Math.max(0.001, high - low), bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: '#d9a44b', metalness: 0.6, roughness: 0.35 }),
    )
    mesh.position.set(x, y, low)
    mesh.frustumCulled = false
    group.add(mesh)
    for (const z of [low, high]) {
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(hole / 2, diameter / 2, 24),
        new THREE.MeshBasicMaterial({ color: '#d9a44b', side: THREE.DoubleSide }),
      )
      pad.position.set(x, y, z)
      group.add(pad)
    }
  }
  for (const via of circuit.filter((record) => record.type === 'pcb_via'))
    if (via.layers.length) barrel(via.x, via.y, via.layers[0], via.layers.at(-1)!, via.hole_diameter, via.outer_diameter)
  for (const trace of circuit.filter((record) => record.type === 'pcb_trace'))
    for (const via of resolveRouteVias(circuit, trace).filter((point) => point.route_type === 'via'))
      barrel(via.x, via.y, via.from_layer, via.to_layer, via.hole_diameter ?? 0.2, via.outer_diameter ?? 0.3)
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
    if (circuit.some((record) => record.type === 'cad_component' && record.pcb_component_id === component.pcb_component_id && (record.model_obj_url || record.model_stl_url || record.model_gltf_url || record.model_jscad || record.footprinter_string))) continue
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
      `${source && source.type === 'source_component' ? source.name : component.pcb_component_id} · no model`,
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
