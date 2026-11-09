// Copied from tests/general.test.mjs: the single-lane extraction/reduction test. Assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import {geometryFromCircuitJson} from '../../src/board/index.js'
import {fastHenryDeck,fasterCapDeck,loopImpedance,referenceCapacitance} from '../../src/extraction/index.js'
import {barFixture} from './solvers.ts'

test('one signal extraction retains its explicit return and correct 2x2 reduction',()=>{
  const {geometry,modeling:m}=barFixture()
  geometry.cells[0].conductors.splice(1,1)
  assert.equal(geometry.cells[0].conductors.length,2)
  assert.equal((fastHenryDeck(geometry.cells[0],m.extraction).match(/\.external /g)??[]).length,2)
  assert.equal(Object.keys(fasterCapDeck(geometry.cells[0],m.extraction)).length,3)
  assert.deepEqual(loopImpedance([[2,.1],[.1,3]]),[[4.8]])
  const C=referenceCapacitance([[4,-1],[-1,3]])
  assert.ok(Math.abs(C.matrix[0][0]-2.2)<1e-15)
})

test('real TSX microstrip deck separates air, FR-4 and conductor contacts', async () => {
  const { default: Board } = await import('../fixtures/escape-via-plane.tsx')
  const { renderCoreSignals } = await import('../support/core-render.tsx')
  const { modeling } = await import('../fixtures/native-channel.tsx')
  const { default: React } = await import('react')
  const circuit = await renderCoreSignals(React.createElement(Board))
  const settings = { ...modeling, lanes: [{ port: 'DATA', from: { component: 'TX', port: 'Y' }, to: { component: 'RX', port: 'A' } }] }
  const cell = geometryFromCircuitJson(circuit, settings).cells[0]
  const files = fasterCapDeck(cell, settings.extraction)
  const list = files['channel.lst']
  assert.match(list, /^D .* 1 4\.42 /m, 'FR-4 slab must have explicit interfaces to air')
  assert.match(list, /^C sig0.* 1 0 0 0 \+/m, 'upper trace faces see air')
  assert.match(list, /^C sig0.* 4\.42 0 0 0/m, 'trace underside sees the declared FR-4')
  assert.ok(!list.includes('homogeneous dielectric'))
  const coarse = fastHenryDeck(cell, settings.extraction)
  const refined = fastHenryDeck(cell, { ...settings.extraction, filaments: 5, groundMeshMm: .5 })
  assert.match(coarse, /E\d+ .* w=0.00015 .*nwinc=9 /, '150 um trace needs nine width filaments at 100 MHz')
  assert.match(refined, /E\d+ .* w=0.00015 .*nwinc=11 /, 'refinement must increase physical cross-section resolution')
})
