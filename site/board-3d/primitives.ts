import * as THREE from 'three'
import type { BoardPosition } from '../../src/board'

/** Add a physical-width cylinder between two board positions. */
export function segment(
  group: THREE.Group,
  a: BoardPosition,
  b: BoardPosition,
  width: number,
  color: string,
  opacity: number = 1,
): THREE.Mesh {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const delta = end.clone().sub(start)
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(width / 2, width / 2, Math.max(delta.length(), 0.00001), 8),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }),
  )
  mesh.position.copy(start.add(end).multiplyScalar(0.5))
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
  mesh.frustumCulled = false
  group.add(mesh)
  return mesh
}

/** Add a pad/probe marker without removing any underlying board geometry. */
export function marker(group: THREE.Group, point: BoardPosition, radius: number, color: string): void {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color }))
  mesh.position.set(...point)
  mesh.frustumCulled = false
  group.add(mesh)
}

/** Keep labels at a constant screen size (stacked by row above their anchor) and legible through the board while their anchors stay in the physical scene. */
export function label(group: THREE.Group, point: BoardPosition, text: string, row: number = 0): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  canvas.width = Math.max(128, text.length * 17 + 16)
  canvas.height = 48
  context.fillStyle = '#ffffffee'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#0f172a'
  context.font = '28px sans-serif'
  context.fillText(text, 8, 34)
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false }))
  sprite.position.set(...point)
  sprite.scale.set((0.055 * canvas.width) / canvas.height, 0.055, 1)
  sprite.center.set(0.5, -1.15 * row)
  sprite.renderOrder = 10
  sprite.frustumCulled = false
  group.add(sprite)
  return sprite
}

/** Release only overlay-owned geometry, materials and label textures. */
export function dispose(group: THREE.Group): void {
  group.removeFromParent()
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      const map = (material as THREE.MeshBasicMaterial).map
      map?.dispose()
      material.dispose()
    }
  })
}
