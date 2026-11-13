import * as THREE from 'three'
import { boardFrame, type BoardStackup, type CircuitJson } from '../../src/board'

/** Build each physical dielectric slab, preserving the board outline and drilled via holes. */
export function physicalStack(circuit: CircuitJson, stack: BoardStackup): THREE.Group {
  const group = new THREE.Group()
  group.name = 'physical-board-stack'
  const board = circuit.find((record) => record.type === 'pcb_board')!
  if (board.type !== 'pcb_board') return group
  const outline = board.outline?.length
    ? board.outline
    : [
        { x: board.center.x - (board.width ?? 20) / 2, y: board.center.y - (board.height ?? 20) / 2 },
        { x: board.center.x + (board.width ?? 20) / 2, y: board.center.y - (board.height ?? 20) / 2 },
        { x: board.center.x + (board.width ?? 20) / 2, y: board.center.y + (board.height ?? 20) / 2 },
        { x: board.center.x - (board.width ?? 20) / 2, y: board.center.y + (board.height ?? 20) / 2 },
      ]
  const shape = new THREE.Shape(outline.map((point) => new THREE.Vector2(point.x, point.y)))
  for (const via of circuit.filter((record) => record.type === 'pcb_via')) {
    const hole = new THREE.Path()
    hole.absarc(via.x, via.y, via.hole_diameter / 2, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  const frame = boardFrame(stack)
  for (const [index, dielectric] of stack.dielectrics.entries()) {
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: dielectric.zMaxMm - dielectric.zMinMm, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: index % 2 ? '#d6b77b' : '#527c68', roughness: 0.8 }),
    )
    mesh.position.z = dielectric.zMinMm - frame.center
    mesh.name = `dielectric-${index}`
    mesh.userData.kind = 'dielectric'
    mesh.frustumCulled = false
    group.add(mesh)
  }
  return group
}
