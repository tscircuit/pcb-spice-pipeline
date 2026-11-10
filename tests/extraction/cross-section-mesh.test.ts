import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCrossSection } from '../../src/extraction'
import { sectionFixture } from './cross-section-fixtures'

test('solid references shield regions, upper-only planes reflect, and invalid cross-sections fail explicitly', () => {
  const section = sectionFixture('mask', 2)
  const original = solveCrossSection(section)
  const reflected = solveCrossSection({ conductors: section.conductors.map(c => ({ ...c, zMm: -c.zMm - c.thicknessMm })), planes: section.planes, dielectrics: section.dielectrics.map(d => ({ ...d, zMm: -d.zMm - d.thicknessMm })) })
  for (const key of ['C', 'L'] as const) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(Math.abs(original[key][i][j] / reflected[key][i][j] - 1) < 1e-8)
  const shielded = solveCrossSection({ ...section, conductors: [section.conductors[0], { ...section.conductors[1], zMm: -1.035 }], dielectrics: [] })
  for (const matrix of [shielded.C, shielded.C0, shielded.L, shielded.skinResistance, shielded.dielectricLoss]) assert.equal(matrix[0][1], 0)
  const permuted = solveCrossSection({ ...section, conductors: [...section.conductors].reverse() })
  for (const key of ['C', 'C0', 'L', 'skinResistance', 'dielectricLoss'] as const) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(Math.abs(original[key][i][j] / permuted[key][1 - i][1 - j] - 1) < 1e-8)
  const close = solveCrossSection({ conductors: [{ id: 'a', xMm: 0, zMm: .1, widthMm: .1, thicknessMm: .035 }, { id: 'b', xMm: .1002, zMm: .1, widthMm: .1, thicknessMm: .035 }], planes: [{ zMm: 0 }], dielectrics: [] })
  assert.ok(close.diagnostics.recessionMm < .0002 / 4)
  assert.throws(() => solveCrossSection({ ...section, planes: [] }), { code: 'native_geometry' })
  assert.throws(() => solveCrossSection({ ...section, conductors: [{ ...section.conductors[0], thicknessMm: 0 }] }), { code: 'native_geometry' })
  assert.throws(() => solveCrossSection({ ...section, conductors: [{ ...section.conductors[0], zMm: 0 }] }), { code: 'native_geometry' })
  assert.throws(() => solveCrossSection({ ...section, conductors: [section.conductors[0], section.conductors[0]] }), { code: 'native_geometry' })
  assert.throws(() => solveCrossSection({ ...section, dielectrics: [...section.dielectrics, section.dielectrics[0]] }), { code: 'native_geometry' })
  assert.throws(() => solveCrossSection(section, { panelsPerEdge: 1 }), { code: 'mesh_convergence' })
  assert.throws(() => original.atFrequency(-1), { code: 'model_frequency' })
})
