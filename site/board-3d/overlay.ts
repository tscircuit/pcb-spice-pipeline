import * as THREE from 'three'
import {
  boardPosition,
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
import { spatialVoltage, voltageColor, type BoardStageState } from './state'

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
  /** Place a true-size rectangle in section coordinates, without the atlas's thin-layer expansion. */
  const band = (x: number, z: number, width: number, height: number, color: string, opacity: number): void => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.position.set(x, z, 0.002)
    mesh.frustumCulled = false
    plane.add(mesh)
  }
  band(0, (frame.top + frame.bottom) / 2, boardWidth, frame.top - frame.bottom + 1, '#f59e0b', 0.13)
  if (!fields) return
  for (const dielectric of section.dielectrics)
    band((low + high) / 2, dielectric.zMm + dielectric.thicknessMm / 2, high - low, dielectric.thicknessMm, '#38bdf8', 0.55)
  for (const conductor of section.conductors)
    band(conductor.xMm, conductor.zMm + conductor.thicknessMm / 2, conductor.widthMm, conductor.thicknessMm, '#fbbf24', 1)
  for (const reference of section.planes) band((low + high) / 2, reference.zMm, high - low, 0.008, '#22c55e', 1)
  const point = [...pose.origin] as [number, number, number]
  point[2] += frame.top + 1.8
  const values = slice.line.C.map(
    (row, i) =>
      `C${i} ${(row[i] * 1e12).toFixed(1)} pF/m · L${i} ${(slice.line.L[i][i] * 1e9).toFixed(1)} nH/m · Z0 ${Math.sqrt(slice.line.L[i][i] / row[i]).toFixed(1)} Ω`,
  ).join(' | ')
  label(group, point, values, Math.max(0.45, boardWidth / 65))
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
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'signal-integrity-overlay'
  const selected = new Set(state.scopes.flatMap((scope) => scope.selectedPcbTraceIds))
  const neighbours = new Set(state.scopes.flatMap((scope) => scope.pcbTraceIds).filter((id) => !selected.has(id)))
  const routes = copperRoutes(circuit)
  if (step >= 1)
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
  if (step >= 2) {
    for (const slice of rawSlices)
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
  if (step >= 4)
    for (const binding of state.bindings)
      for (const model of binding.models)
        for (const pin of model.metadata.pins) {
          const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === pin.port)
          if (port?.type !== 'pcb_port') continue
          const driver = binding.plan.states.some((state) => state.source_port_id === pin.port && state.is_output)
          const point = boardPosition(stack, port.x, port.y, port.layers[0])
          marker(group, point, 0.17, driver ? '#2563eb' : '#06b6d4')
          label(group, [point[0], point[1], point[2] + 0.8], `${driver ? 'TX' : 'RX'} ${pin.model}`, 0.5)
        }
  if (step >= 5)
    for (const network of state.networks) {
      const wires = network.evidence.wires as RouteWire[]
      const ticks = network.evidence.node_ticks as { wire: number; position: number; node: string }[] | undefined
      for (const tick of ticks ?? []) {
        const wire = wires.find((wire) => wire.id === tick.wire)
        if (!wire) continue
        const [x, y] = routePosition(wire, tick.position)
        const a = boardPosition(stack, x - wire.u[1] * 0.2, y + wire.u[0] * 0.2, wire.layer)
        const b = boardPosition(stack, x + wire.u[1] * 0.2, y - wire.u[0] * 0.2, wire.layer)
        segment(group, a, b, 0.04, '#c026d3')
      }
    }
  if (step >= 6)
    for (const capture of state.captures) {
      const spatial = capture.spatial
      if (spatial) {
        // Native saved nodes colour their nearest portion of actual route copper. No connection is drawn across bends or between nets.
        for (const route of routes) {
          const points = spatial.points.flatMap((point, index) =>
            point.layer === route.layer && (point.net === route.net || point.net === route.trace) ? [{ point, index }] : [],
          )
          if (!points.length) continue
          const length = Math.hypot(route.b[0] - route.a[0], route.b[1] - route.a[1])
          const count = Math.max(1, Math.ceil(length / 0.25))
          for (let i = 0; i < count; i++) {
            const a = route.a.map((value, axis) => value + ((route.b[axis] - value) * i) / count) as [number, number]
            const b = route.a.map((value, axis) => value + ((route.b[axis] - value) * (i + 1)) / count) as [number, number]
            const near = points.reduce((best, entry) =>
              Math.hypot(entry.point.x - (a[0] + b[0]) / 2, entry.point.y - (a[1] + b[1]) / 2) <
              Math.hypot(best.point.x - (a[0] + b[0]) / 2, best.point.y - (a[1] + b[1]) / 2)
                ? entry
                : best,
            )
            const voltage = spatialVoltage(spatial, near.index, time)
            if (voltage !== undefined) {
              const mesh = segment(
                group,
                boardPosition(stack, ...a, route.layer),
                boardPosition(stack, ...b, route.layer),
                route.width * 1.5,
                voltageColor(voltage),
              )
              mesh.userData.spatial = spatial
              mesh.userData.pointIndex = near.index
            }
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
          marker(group, point, 0.23, '#dc2626')
          label(group, [point[0], point[1], point[2] + 1.5], `${probe.name}${ports.length > 1 ? (index ? ' (−)' : ' (+)') : ''}`, 0.55)
        }
      }
    }

  // Inspection marks remain visible at their exact layer depth through the x-ray board and component bodies.
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material as THREE.MeshBasicMaterial
    material.depthTest = false
    material.depthWrite = false
    object.renderOrder = 4
  })
  return group
}
