import test from 'node:test'
import assert from 'node:assert/strict'
import { potentials, fieldGrid, type FieldGrid } from '../../src/extraction/grid'
import { reviewBoard } from '../fixtures/review-geometry'
import { geometryFromCircuitJson } from '../../src/board'

// Independent nodal balance checks the sparse ordering/fill and multiple right-hand sides.
test('sparse Laplace factor preserves Gauss balance for every actual TSX conductor excitation', async () => {
  const { circuitJson, modeling } = await reviewBoard({ parallel: true })
  const slice = geometryFromCircuitJson(circuitJson, modeling).cells.find(c => c.ports.length === 3)!.slice!
  const grid = fieldGrid(slice, 1, 20, false)
  const groups = Math.max(...slice.conductors.map(c => c.group)) + 1
  const fields = potentials(grid, groups)
  for (let j = 0; j < groups; j++) {
    const residual = new Float64Array(grid.size)
    let scale = 0
    for (const e of grid.edges) {
      const a = e.a >= 0 ? fields[j][e.a] : Number(-e.a - 2 === j)
      const b = e.b >= 0 ? fields[j][e.b] : Number(-e.b - 2 === j)
      const flux = e.weight * (a - b)
      if (e.a >= 0) residual[e.a] += flux
      if (e.b >= 0) residual[e.b] -= flux
      scale += Math.abs(flux)
    }
    assert.ok(residual.reduce((sum, value) => sum + Math.abs(value), 0) / scale < 1e-10)
    assert.ok(fields[j].every(v => v >= -1e-10 && v <= 1 + 1e-10), 'discrete maximum principle')
  }
})

test('an unreferenced sparse field fails by name instead of inventing a ground', () => {
  const grid: FieldGrid = { size: 1, width: 1, height: 1, x: [0, 1], z: [0, 1], ids: new Int32Array([0]), edges: [] }
  assert.throws(() => potentials(grid, 1), { code: 'matrix_singular' })
})
