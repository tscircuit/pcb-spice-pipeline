import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewBoard } from '../../fixtures/review-geometry'
import { geometryFromCircuitJson } from '../../../src/board'
import { solveCrossSection } from '../../../src/extraction'

test('review 6: reference stitching via records its net/layers and only changes intersecting slices', async () => {
  const { circuitJson, modeling } = await reviewBoard({ via: true })
  const geometry = geometryFromCircuitJson(circuitJson, modeling)
  const via = geometry.referenceVias![0]
  assert.equal(via.physicalNet, 'GROUND')
  assert.deepEqual(via.layers, ['bottom', 'top'])
  assert.equal(via.platingMm, .025)
  const cuts = new Set(geometry.cells.flatMap(c => [c.start[0], c.end[0]]))
  for (const x of [.4, .575, .6, 1, 1.4, 1.425, 1.6]) assert.ok(cuts.has(x), `tangent ${x}`)
  const changed = geometry.cells.filter(c => c.slice!.conductors.some(c => c.id === via.id))
  assert.ok(changed.length > 0)
  for (const cell of changed) assert.ok(cell.start[0] >= .4 && cell.end[0] <= 1.6)
  const section = changed.find(c => c.start[0] === 1)!.slice!
  assert.ok(section.conductors.some(c => c.id === via.id && c.zMin === 0 && c.zMax === 1.53))
  assert.ok(section.conductors.some(c => c.id === via.id && c.zMin === 1.53))
  assert.ok(section.dielectrics.every(d => d.xMax <= .654 || d.xMin >= 1.346))
  const result = solveCrossSection(section)
  assert.ok(result.steps.at(-1)!.residual! < .005)
  const without = geometryFromCircuitJson((await reviewBoard()).circuitJson, modeling).cells.find(c => c.start[0] < 1 && c.end[0] > 1)!
  const reference = solveCrossSection(without.slice!)
  assert.ok(Math.abs(result.C[0][0] / reference.C[0][0] - 1) > .01, 'barrel/pad field effect is present')
})


test('review 6: an electrically unclassified non-route via still raises reference_via', async () => {
  const { circuitJson, modeling } = await reviewBoard({ via: true, viaNet: 'OTHER' })
  assert.throws(() => geometryFromCircuitJson(circuitJson, modeling), { code: 'reference_via' })
})

test('review 6: all four examples classify reference vias without reference_via rejection', async () => {
  for (const name of ['single-ended', 'differential-data', 'crosstalk', 'multilayer']) {
    const { circuitJson, modeling } = await import(`../../../examples/${name}/index.circuit`)
    try {
      const result = geometryFromCircuitJson(circuitJson, modeling)
      assert.ok(result.referenceVias!.length > 0)
      assert.ok(result.referenceVias!.some(v => v.physicalNet === 'GROUND'))
      if (name === 'single-ended') assert.ok(result.referenceVias!.some(v => v.physicalNet !== 'GROUND'))
    } catch (error) {
      assert.ok(error instanceof Error && 'code' in error)
      assert.notEqual(error.code, 'reference_via', name)
      assert.ok(['oblique_coupling', 'varying_cross_section'].includes(String(error.code)), `${name}: ${error}`)
    }
  }
})


test('reference-via plating conductivity is never guessed from mixed copper materials', async () => {
  const { circuitJson, modeling } = await reviewBoard({ via: true, mixedCopper: true })
  assert.throws(() => geometryFromCircuitJson(circuitJson, modeling), { code: 'via_geometry' })
})
