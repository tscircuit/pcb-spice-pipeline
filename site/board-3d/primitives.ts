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

export interface LabelStyle {
  /** Stack upward by whole label heights above the anchor. */
  row?: number
  tone?: 'plain' | 'callout' | 'coupling' | 'subtle'
}

const tones = {
  plain: { background: '#ffffffee', text: '#0f172a', size: 0.05 },
  callout: { background: '#0f172a', text: '#f8fafc', size: 0.05 },
  coupling: { background: '#4c1d95', text: '#f5f3ff', size: 0.05 },
  subtle: { background: '#ffffff00', text: '#64748b', size: 0.04 },
} as const

/** Constant-screen-size label, legible through the board, anchored at its bottom centre in the physical scene. */
export function label(group: THREE.Group, point: BoardPosition, text: string, style: LabelStyle = {}): THREE.Sprite {
  const tone = tones[style.tone ?? 'plain']
  const lines = text.split('\n')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const font = '600 28px system-ui, sans-serif'
  context.font = font
  canvas.width = Math.ceil(Math.max(...lines.map((line) => context.measureText(line).width))) + 24
  canvas.height = lines.length * 34 + 14
  context.fillStyle = tone.background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = tone.text
  context.font = font
  for (const [i, line] of lines.entries()) context.fillText(line, 12, 34 + i * 34)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false }))
  sprite.position.set(...point)
  const height = (tone.size * canvas.height) / 48
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1)
  sprite.center.set(0.5, -1.1 * (style.row ?? 0))
  sprite.renderOrder = 10
  sprite.frustumCulled = false
  group.add(sprite)
  return sprite
}

/** A thin straight or polyline mark (leaders, break marks) drawn over the scene. */
export function line(group: THREE.Group, points: BoardPosition[], color: string): THREE.Line {
  const mesh = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point))),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
  )
  mesh.renderOrder = 9
  mesh.frustumCulled = false
  group.add(mesh)
  return mesh
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
