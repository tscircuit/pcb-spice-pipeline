import test from 'node:test'
import assert from 'node:assert/strict'
import { groundMesh, mergeLayerPours } from '../src/copper.js'

type Pour = Parameters<typeof mergeLayerPours>[0][number]
const rect = (id: string, layer: string, x0: number, y0: number, x1: number, y1: number, z = 0): Pour => ({
  pcbCopperPourId: id, layer, zMinMm: z, zMaxMm: z + .035,
  polygon: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
})
const area = (ring: number[][]) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) / 2)

// Reduced from the AM3352 board: one GND plane per layer tiled from adjacent
// bands. Meshing the bands separately put coincident conductors on each seam.
test('touching same-layer pours merge into one plane before meshing', () => {
  const pours = [
    rect('band_0', 'inner1', 0, 6, 12, 10),
    rect('band_1', 'inner1', 0, 3, 12, 6),
    rect('band_2', 'inner1', 0, 0, 12, 3),
    rect('island', 'inner1', 20, 0, 22, 2),
    rect('other_layer', 'inner3', 0, 0, 12, 10, .5),
  ]
  const merged = mergeLayerPours(pours)
  assert.deepEqual(merged.map(p => p.pcbCopperPourId).sort(), ['band_0+band_1+band_2', 'island', 'other_layer'])
  const plane = merged.find(p => p.pcbCopperPourId.startsWith('band_0'))!
  assert.equal(plane.polygon.length, 1)
  assert.ok(Math.abs(area(plane.polygon[0]) - 120) < 1e-9)
  assert.deepEqual([plane.zMinMm, plane.zMaxMm], [0, .035])

  // No two mesh conductors share a center (FastHenry: "filaments had identical centers").
  const centers = (pour: Pour) => {
    const mesh = groundMesh(pour, 3, [])
    return mesh.edges.map(([a, b]) => mesh.points[a].map((v, i) => ((v + mesh.points[b][i]) / 2).toFixed(9)).join(','))
  }
  const mergedCenters = centers(plane)
  assert.equal(new Set(mergedCenters).size, mergedCenters.length)
  const separate = pours.slice(0, 3).flatMap(centers)
  assert.ok(new Set(separate).size < separate.length, 'separately meshed bands duplicate their shared edges')
})
