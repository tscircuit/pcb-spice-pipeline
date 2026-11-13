import * as THREE from 'three'
import {
  boardPosition,
  boardRouteSegments,
  boardSectionView,
  boardSectionZ,
  boardSlicePose,
  boardFrame,
  routePosition,
  type BoardPosition,
  type BoardStackup,
  type CircuitJson,
  type RouteWire,
} from '../../src/board'
import type { CrossSection, ExtractedRouteSlice, RouteMaterials } from '../../src/extraction'
import { copperRoutes } from './copper'
import { label, line, marker, segment } from './primitives'
import { routeVoltagePositions, routeVoltageBlend, routeVoltageAt, routeVoltageRange } from '../../src/simulation'
import { spatialRouteIndices, voltageColor, type BoardStageState } from './state'

const slabColors = ['#bfdbfe', '#c7d2fe', '#a5f3fc', '#ddd6fe']

/** Draw the exact solver section in its slice plane: copper and nearest plane framed, z mapped by boardSectionZ. */
function sectionPlane(
  group: THREE.Group,
  stack: BoardStackup,
  slice: ExtractedRouteSlice,
  fraction: number,
  materials: RouteMaterials,
  aspect: number,
): void {
  const pose = boardSlicePose(stack, slice, fraction)
  const view = boardSectionView(stack, slice, aspect)
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
  /** Map section coordinates (x transverse, z stack) to a world point in this slice plane. */
  const world = (x: number, z: number): BoardPosition =>
    new THREE.Vector3(x, boardSectionZ(view, z), 0).applyQuaternion(plane.quaternion).add(plane.position).toArray()
  /** Fill a section rectangle clipped to the framed window. */
  const band = (x0: number, x1: number, z0: number, z1: number, color: string, order: number): void => {
    const left = Math.max(view.left, x0)
    const right = Math.min(view.right, x1)
    const low = boardSectionZ(view, Math.max(view.bottom, z0))
    const high = boardSectionZ(view, Math.min(view.top, z1))
    if (right <= left || high <= low) return
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(right - left, high - low), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    mesh.position.set((left + right) / 2, (low + high) / 2, 0)
    // Coplanar bands draw in a fixed order: dielectric, then plane, then copper.
    mesh.renderOrder = order
    mesh.frustumCulled = false
    plane.add(mesh)
  }
  const section = JSON.parse(slice.key) as CrossSection
  /** The opposite face of the copper layer that a reference surface lies on. */
  const face = (z: number): number => {
    const layer = stack.copperLayers.find((entry) => Math.abs(entry.zMinMm - z) < 1e-6 || Math.abs(entry.zMaxMm - z) < 1e-6)
    return !layer ? z : Math.abs(layer.zMinMm - z) < 1e-6 ? layer.zMaxMm : layer.zMinMm
  }
  for (const [index, dielectric] of section.dielectrics.entries()) {
    const copper = section.conductors[0]?.thicknessMm ?? 0
    const mask = dielectric.er === materials.maskEr && Math.abs(dielectric.thicknessMm - copper - materials.maskMm) < 1e-6
    const top = dielectric.zMm + dielectric.thicknessMm
    band(view.left, view.right, dielectric.zMm, top, mask ? '#4ade80' : slabColors[index % slabColors.length], 5)
    const middle = (Math.max(view.bottom, dielectric.zMm) + Math.min(view.top, top)) / 2
    if (middle > view.bottom && middle < view.top && !(middle > view.gap.from && middle < view.gap.to))
      label(group, world(view.right, middle), `${mask ? 'mask ' : ''}εr ${dielectric.er}`, { tone: 'subtle' })
  }
  for (const reference of section.planes) {
    const other = face(reference.zMm)
    band(view.left, view.right, Math.min(reference.zMm, other), Math.max(reference.zMm, other), '#b45309', 6)
    const net = slice.references.find((entry) => Math.abs(entry.z - reference.zMm) < 1e-6)?.net
    if (reference.zMm >= view.bottom && reference.zMm <= view.top) label(group, world(view.left, reference.zMm), net ?? 'reference', { tone: 'subtle' })
  }
  for (const conductor of section.conductors)
    band(conductor.xMm - conductor.widthMm / 2, conductor.xMm + conductor.widthMm / 2, conductor.zMm, conductor.zMm + conductor.thicknessMm, '#d97706', 7)
  if (view.gap.scale < 1) {
    // Break marks show where the bulk dielectric is drawn compressed.
    const middle = (view.gap.from + view.gap.to) / 2
    const steps = 12
    const amplitude = (boardSectionZ(view, view.top) - boardSectionZ(view, view.bottom)) * 0.025
    for (const offset of [-1, 1])
      line(
        group,
        Array.from({ length: steps + 1 }, (_, i) => {
          const x = view.left + ((view.right - view.left) * i) / steps
          const point = new THREE.Vector3(x, boardSectionZ(view, middle) + offset * amplitude * 1.6 + (i % 2 ? amplitude : -amplitude), 0)
          return point.applyQuaternion(plane.quaternion).add(plane.position).toArray()
        }),
        '#334155',
      )
  }
  // Callouts in one row above the window, ordered by conductor position, coupling between adjacent pairs.
  const order = section.conductors.map((conductor, index) => ({ conductor, index })).sort((a, b) => a.conductor.xMm - b.conductor.xMm)
  const items: { text: string; tone: 'callout' | 'coupling'; targets: number[] }[] = []
  for (const [k, { index }] of order.entries()) {
    const c = slice.line.C[index]?.[index]
    const l = slice.line.L[index]?.[index]
    if (c === undefined || l === undefined) continue
    if (k > 0) {
      const previous = order[k - 1].index
      const mutual = slice.line.L[index][previous]
      const coupling = mutual / Math.sqrt(l * slice.line.L[previous][previous])
      if (coupling > 0.005)
        items.push({
          text: `k ${coupling.toFixed(2)}\nCm ${(-slice.line.C[index][previous] * 1e12).toFixed(1)} pF/m\nLm ${(mutual * 1e9).toFixed(0)} nH/m`,
          tone: 'coupling',
          targets: [previous, index],
        })
    }
    items.push({ text: `Z0 ${Math.sqrt(l / c).toFixed(1)} Ω\nC ${(c * 1e12).toFixed(1)} pF/m\nL ${(l * 1e9).toFixed(0)} nH/m`, tone: 'callout', targets: [index] })
  }
  const top = boardSectionZ(view, view.top)
  const rise = (top - boardSectionZ(view, view.bottom)) * 0.25 + (view.right - view.left) * 0.04
  for (const [i, item] of items.entries()) {
    const x = view.left + ((i + 0.5) * (view.right - view.left)) / items.length
    const anchor = new THREE.Vector3(x, top + rise, 0).applyQuaternion(plane.quaternion).add(plane.position).toArray()
    label(group, anchor, item.text, { tone: item.tone })
    for (const target of item.targets) {
      const conductor = section.conductors[target]
      line(group, [anchor, world(conductor.xMm, conductor.zMm + conductor.thicknessMm)], item.tone === 'coupling' ? '#7c3aed' : '#0f172a')
    }
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
  aspect: number = 2.4,
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
        // Admission pulses this halo (see the panel) rather than pushing the camera in.
        segment(group, a, b, route.width * 2.8, '#38bdf8', 0.2).userData.pulse = step === 1
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
      const field = state.fields.find((entry) => entry.slices.includes(active as ExtractedRouteSlice))
      if ('key' in active && field) sectionPlane(group, stack, active as ExtractedRouteSlice, fraction, field.materials, aspect)
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
  const range = routeVoltageRange(state.captures)
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
            const mesh = segment(group, a, b, route.width * 1.4, voltageColor(routeVoltageAt(spatial, blend, time), range))
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
    if (!object.renderOrder) object.renderOrder = 8
  })
  return group
}
