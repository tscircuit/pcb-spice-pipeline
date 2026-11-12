import * as THREE from 'three'
import {
  boardPosition,
  boardRouteSegments,
  boardSlicePose,
  boardFrame,
  routePosition,
  type BoardStackup,
  type CircuitJson,
  type RouteWire,
} from '../../src/board'
import type { CrossSection, ExtractedRouteSlice } from '../../src/extraction'
import { copperRoutes } from './copper'
import { label, marker, segment } from './primitives'
import { routeVoltagePositions, routeVoltageBlend, routeVoltageAt } from '../../src/simulation'
import { spatialRouteIndices, voltageColor, type BoardStageState } from './state'

/** Use the exact solver section JSON in its true-scale transverse/vertical physical frame. */
function sectionPlane(
  group: THREE.Group,
  stack: BoardStackup,
  slice: ExtractedRouteSlice,
  fraction: number,
  fields: boolean,
  boardWidth: number,
): void {
  const pose = boardSlicePose(stack, slice, fraction)
  const plane = new THREE.Group()
  plane.position.set(...pose.origin)
  plane.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...pose.transverse),
      new THREE.Vector3(...pose.vertical),
      new THREE.Vector3(...pose.normal),
    ),
  )
  group.add(plane)
  const section = JSON.parse(slice.key) as CrossSection
  const low = Math.min(...section.conductors.map((conductor) => conductor.xMm - conductor.widthMm / 2)) - 0.3
  const high = Math.max(...section.conductors.map((conductor) => conductor.xMm + conductor.widthMm / 2)) + 0.3
  const frame = boardFrame(stack)
  /** Place a true-size rectangle in section coordinates, without expanding thin layers. */
  const band = (x: number, z: number, width: number, height: number, color: string, opacity: number): void => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.position.set(x, z, 0.002)
    mesh.frustumCulled = false
    plane.add(mesh)
  }
  if (!fields) band(0, (frame.top + frame.bottom) / 2, boardWidth, frame.top - frame.bottom + 1, '#f59e0b', 0.13)
  if (!fields) return
  for (const [index, dielectric] of section.dielectrics.entries())
    band((low + high) / 2, dielectric.zMm + dielectric.thicknessMm / 2, high - low, dielectric.thicknessMm, index % 2 ? '#7dd3fc' : '#38bdf8', 0.55)
  for (const conductor of section.conductors)
    band(conductor.xMm, conductor.zMm + conductor.thicknessMm / 2, conductor.widthMm, conductor.thicknessMm, '#fbbf24', 1)
  for (const reference of section.planes) band((low + high) / 2, reference.zMm, high - low, 0.008, '#22c55e', 1)
  // One per-unit-length label above each conductor, anchored in the slice plane.
  for (const [i, conductor] of section.conductors.entries()) {
    const c = slice.line.C[i]?.[i]
    const l = slice.line.L[i]?.[i]
    if (c === undefined || l === undefined) continue
    const point = new THREE.Vector3(conductor.xMm, conductor.zMm + conductor.thicknessMm * 3, 0).applyQuaternion(plane.quaternion).add(plane.position)
    label(group, point.toArray(), `C ${(c * 1e12).toFixed(1)} pF/m · L ${(l * 1e9).toFixed(0)} nH/m · Z0 ${Math.sqrt(l / c).toFixed(1)} Ω`, i)
  }
}

/** Draw selected and neighbouring copper, physical sections, bindings and actual ladder node ticks. */
export function stageOverlay(
  circuit: CircuitJson,
  stack: BoardStackup,
  state: BoardStageState,
  step: number,
  sliceIndex: number,
  fraction: number,
  time: number,
  progress: number = 1,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'signal-integrity-overlay'
  const selected = new Set(state.scopes.flatMap((scope) => scope.selectedPcbTraceIds))
  const neighbours = new Set(state.scopes.flatMap((scope) => scope.pcbTraceIds).filter((id) => !selected.has(id)))
  const routes = copperRoutes(circuit)
  if (step >= 1 && step !== 3 && step !== 6)
    for (const route of routes) {
      if (!selected.has(route.trace) && !neighbours.has(route.trace)) continue
      const a = boardPosition(stack, ...route.a, route.layer)
      const b = boardPosition(stack, ...route.b, route.layer)
      if (selected.has(route.trace)) {
        segment(group, a, b, route.width * 2.8, '#38bdf8', 0.2)
        segment(group, a, b, route.width * 1.15, '#0284c7')
      } else {
        segment(group, a, b, route.width * 1.7, '#475569', 0.45)
        segment(group, a, b, route.width, '#d4ad62')
      }
    }
  const slices = state.fields.flatMap((field) => field.slices)
  const rawSlices = state.sections.flatMap((section) => section.geometry.slices)
  const active = (step >= 3 ? slices : rawSlices)[sliceIndex % Math.max(1, step >= 3 ? slices.length : rawSlices.length)]
  if (step === 2 || step === 3) {
    for (const slice of step === 2 ? rawSlices : [])
      for (const wire of slice.wires) {
        segment(
          group,
          boardPosition(stack, ...routePosition(wire, slice.start), wire.layer),
          boardPosition(stack, ...routePosition(wire, slice.end), wire.layer),
          wire.width * 0.4,
          '#22c55e',
        )
      }
    if (active) {
      const board = circuit.find((record) => record.type === 'pcb_board')
      const span = board?.type === 'pcb_board' ? Math.hypot(board.width ?? 20, board.height ?? 20) : 20
      if ('key' in active) sectionPlane(group, stack, active as ExtractedRouteSlice, fraction, step >= 3, span)
      else {
        const pose = boardSlicePose(stack, active, fraction)
        const frame = boardFrame(stack)
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(span, frame.top - frame.bottom + 1),
          new THREE.MeshBasicMaterial({ color: '#f59e0b', opacity: 0.2, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
        )
        plane.position.set(pose.origin[0], pose.origin[1], 0)
        plane.quaternion.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(
            new THREE.Vector3(...pose.transverse),
            new THREE.Vector3(...pose.vertical),
            new THREE.Vector3(...pose.normal),
          ),
        )
        plane.frustumCulled = false
        group.add(plane)
      }
    }
  }
  if (step === 4)
    for (const binding of state.bindings)
      for (const model of binding.models)
        for (const pin of model.metadata.pins) {
          const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === pin.port)
          if (port?.type !== 'pcb_port') continue
          const driver = binding.plan.states.some((state) => state.source_port_id === pin.port && state.is_output)
          const point = boardPosition(stack, port.x, port.y, port.layers[0])
          const focused = driver === progress < 0.5
          marker(group, point, focused ? 0.15 : 0.07, focused ? '#f59e0b' : '#06b6d4')
          if (focused) label(group, [point[0], point[1], point[2] + 0.1], `${driver ? 'TX' : 'RX'} ${pin.model}`)
        }
  if (step === 5)
    for (const network of state.networks) {
      const wires = network.evidence.wires as RouteWire[]
      const ticks = network.evidence.node_ticks as { wire: number; position: number; node: string }[] | undefined
      for (const [index, tick] of (ticks ?? []).entries()) {
        const wire = wires.find((wire) => wire.id === tick.wire)
        if (!wire) continue
        const [x, y] = routePosition(wire, tick.position)
        const a = boardPosition(stack, x - wire.u[1] * 0.2, y + wire.u[0] * 0.2, wire.layer)
        const b = boardPosition(stack, x + wire.u[1] * 0.2, y - wire.u[0] * 0.2, wire.layer)
        const active = index === Math.round(progress * ((ticks?.length ?? 1) - 1))
        segment(group, a, b, active ? 0.08 : 0.04, active ? '#f59e0b' : '#c026d3')
        if (active) {
          marker(group, boardPosition(stack, x, y, wire.layer), 0.12, '#f59e0b')
          label(group, [x, y, a[2] + 0.1], `Cell ${index + 1} · ${tick.node}`)
        }
      }
    }
  if (step >= 6)
    for (const [captureIndex, capture] of state.captures.entries()) {
      const spatial = capture.spatial
      if (spatial) {
        const physical = boardRouteSegments(circuit, stack)
        const indices = new Map<string, ReturnType<typeof routeVoltagePositions>>()
        for (const route of physical) {
          if (!indices.has(route.trace)) {
            const native = spatialRouteIndices(
              circuit,
              state.bindings[captureIndex] ? [state.bindings[captureIndex]] : [],
              spatial,
              route.trace,
            )
            indices.set(
              route.trace,
              routeVoltagePositions(
                physical.filter((part) => part.trace === route.trace),
                stack,
                spatial,
                native,
              ),
            )
          }
          const points = indices.get(route.trace)!
          const count = Math.max(1, Math.ceil((route.end - route.start) / 0.15))
          for (let i = 0; i < count; i++) {
            const blend = routeVoltageBlend(points, route.start + ((route.end - route.start) * (i + 0.5)) / count)
            if (!blend) continue
            const a = route.a.map((value, axis) => value + ((route.b[axis] - value) * i) / count) as [number, number, number]
            const b = route.a.map((value, axis) => value + ((route.b[axis] - value) * (i + 1)) / count) as [number, number, number]
            const mesh = segment(group, a, b, route.width * 1.4, voltageColor(routeVoltageAt(spatial, blend, time)))
            mesh.userData.spatial = spatial
            mesh.userData.blend = blend
          }
        }
      }
      for (const probe of capture.probes) {
        const measurement = state.networks
          .flatMap((network) => network.probes)
          .find((entry) => entry.signalSourceId === probe.sourcePortId && entry.name === probe.name)
        const ports = [probe.sourcePortId, ...(measurement?.referenceSourceId ? [measurement.referenceSourceId] : [])]
        for (const [index, id] of ports.entries()) {
          const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === id)
          if (port?.type !== 'pcb_port') continue
          const point = boardPosition(stack, port.x, port.y, port.layers[0])
          marker(group, point, 0.1, '#dc2626')
          label(group, [point[0], point[1], point[2] + 0.15], `${probe.name}${ports.length > 1 ? (index ? ' (−)' : ' (+)') : ''}`)
        }
      }
    }

  // Inspection marks remain visible at their exact layer depth through the x-ray board and component bodies.
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material as THREE.MeshBasicMaterial
    material.depthTest = false
    material.depthWrite = false
    // Translucent board layers render in the transparent pass; joining it after them keeps marks unwashed.
    material.transparent = true
    object.renderOrder = 8
  })
  return group
}
