import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { Clipper64, PolyTree64, ClipType, FillRule } from 'clipper2-ts'
import Board, { modeling } from '../fixtures/layered-microstrip'
import { renderCoreSignals } from '../support/core-render'
import { geometryFromCircuitJson, polygonContains } from '../../src/board'
import { fasterCapDeck, parseFasterCap, validateMatrix, referenceCapacitance } from '../../src/extraction'
import { symmetrize } from '../../src/extraction/linalg'
import { pathSolids } from '../../src/extraction/mesh'
import { checkNativeRun } from '../../src/extraction/parse'
import { createNativeSolver } from '../../src/adapters'

for (const coupled of [false, true]) test(`layered TSX ${coupled ? 'coupled' : 'single'} microstrip ground-referenced signal block passes before symmetrization`, {
  skip: process.env.SI_TEST_NATIVE_CAPACITANCE !== '1', timeout: 180000,
}, async () => {
  const circuit = await renderCoreSignals(React.createElement(Board, { coupled }))
  const settings = { ...modeling, lanes: modeling.lanes.slice(0, coupled ? 2 : 1) }
  const cell = geometryFromCircuitJson(circuit, settings).cells[0]
  const solver = createNativeSolver({ timeoutMs: 150000, tools: { fastercap: '/opt/homebrew/bin/FasterCap' } })
  const run = await solver({ solver: 'fastercap', args: ['channel.lst', '-b', '-a0.02', '-ap', '-e'], files: fasterCapDeck(cell, settings.extraction), outputFiles: [] })
  checkNativeRun(run, 'layered-microstrip', 'fastercap')
  const autoResidual = Number([...run.stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1)?.[1])
  assert.ok(autoResidual >= 0 && autoResidual <= settings.extraction.capTolerance)
  const raw = parseFasterCap(run.stdout).matrix
  assert.equal(raw.length, coupled ? 3 : 2)
  assert.throws(() => validateMatrix(raw, 'C primitive', settings.extraction.reciprocityTolerance), /reciprocity/)
  const checked = referenceCapacitance(raw, settings.extraction.reciprocityTolerance)
  assert.deepEqual(checked.matrix, symmetrize(raw.slice(0, -1).map(row => row.slice(0, -1))))
  assert.ok(checked.reciprocityResidual <= settings.extraction.reciprocityTolerance)
})

test('TSX dielectric and contact faces form one closed FR-4 boundary with consistent reference sides', async () => {
  const circuit = await renderCoreSignals(React.createElement(Board))
  const cell = geometryFromCircuitJson(circuit, { ...modeling, lanes: modeling.lanes.slice(0, 1) }).cells[0]
  const files = fasterCapDeck(cell, modeling.extraction)
  const flux = [0, 0, 0]
  let volume = 0
  const directions = new Set<string>()
  const copper = cell.routedCopper!
  const solids = [...copper.signals.flatMap(pathSolids), ...copper.pours]
  // Inspect every C face, including the air-facing portions excluded from the FR-4 closure sum.
  for (const line of files['channel.lst'].split('\n').filter(line => line.startsWith('C '))) {
    const [, file, er] = line.split(' ')
    for (const row of files[file].split('\n').filter(row => /^[TQ] /.test(row))) {
      const values = row.split(' ').slice(2).map(Number)
      const z = values.filter((_, i) => i % 3 === 2)
      const expected = file.startsWith('sig') ? z.every(z => z === 1.43) ? 4.42 : 1 : z.every(z => z === 0) ? 4.42 : 1
      assert.equal(Number(er), expected, `${file}: trace underside and plane top see FR-4; other faces see air`)
    }
  }
  for (const line of files['channel.lst'].split('\n')) {
    const [kind, file, ...values] = line.split(' ')
    if (kind !== 'D' && !(kind === 'C' && Number(values[0]) === 4.42)) continue
    const sign = kind === 'C' ? -1 : 1
    const reference = values.slice(5, 8).map(Number)
    for (const row of files[file].split('\n').filter(row => /^[TQ] /.test(row))) {
      const values = row.split(' ').slice(2).map(Number)
      const points = Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3))
      if (kind === 'D') {
        const center = [0, 1, 2].map(j => points.reduce((sum, p) => sum + p[j], 0) / points.length)
        assert.ok(!solids.some(solid => center[2] >= solid.zMinMm - 1e-10 && center[2] <= solid.zMaxMm + 1e-10 &&
          polygonContains([center[0], center[1]], solid.polygon)), 'no dielectric panel centroid overlaps a copper contact')
        if (points.every(p => p[2] === center[2])) {
          const intersection = new Clipper64()
          const result = new PolyTree64()
          intersection.addSubject([points.map(([x, y]) => ({ x: Math.round(x * 1e8), y: Math.round(y * 1e8) }))])
          intersection.addClip(solids.filter(s => s.zMinMm <= center[2] + 1e-10 && s.zMaxMm >= center[2] - 1e-10)
            .flatMap(s => s.polygon.map(ring => ring.map(([x, y]) => ({ x: Math.round(x * 1e8), y: Math.round(y * 1e8) })))))
          assert.ok(intersection.execute(ClipType.Intersection, FillRule.NonZero, result))
          assert.equal(result.count, 0, 'horizontal D panels have no positive-area overlap with copper contacts at a 1e-8 mm grid')
        }
      }
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[0]
        const u = points[i].map((v, j) => v - a[j])
        const v = points[i + 1].map((v, j) => v - a[j])
        const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        for (let j = 0; j < 3; j++) flux[j] += sign * normal[j] / 2
        volume += sign * normal.reduce((sum, n, j) => sum + n * a[j], 0) / 6
        if (kind === 'D') directions.add(normal.map(n => Math.round(n / Math.hypot(...normal))).join(','))
        if (kind === 'D') assert.ok(normal.reduce((sum, n, j) => sum + n * (reference[j] - a[j]), 0) < 0,
          'the D reference with trailing minus must lie on the FR-4 side of every panel')
      }
    }
  }
  assert.deepEqual([...directions].sort(), ['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0'].sort(), 'top, bottom and all four dielectric side faces exist')
  assert.ok(Math.hypot(...flux) < 1e-7, 'dielectric boundary has no net oriented area gap')
  assert.ok(Math.abs(volume - 50 * 14 * 1.43) < 1e-7, 'D plus reversed copper contacts enclose the declared FR-4 volume')
})

// Recorded native matrices come from the actual TSX fixture, not hand-authored Circuit JSON.
test('recorded TSX microstrip asymmetry is confined to return entries; symmetrize only the passing signal block', async () => {
  const { readFile } = await import('node:fs/promises')
  const evidence = JSON.parse(await readFile(new URL('../evidence/signal-levels/layered-capacitance-investigation.json', import.meta.url), 'utf8'))
  for (const sample of evidence.final_baseline_confirmation) {
    const circuit = await renderCoreSignals(React.createElement(Board, { coupled: sample.coupled }))
    const settings = { ...modeling, lanes: modeling.lanes.slice(0, sample.coupled ? 2 : 1) }
    const cell = geometryFromCircuitJson(circuit, settings).cells[0]
    assert.equal(sample.matrix.length, cell.conductors.length)
    assert.throws(() => validateMatrix(sample.matrix, 'C primitive', settings.extraction.reciprocityTolerance), /reciprocity/)
    const checked = referenceCapacitance(sample.matrix, settings.extraction.reciprocityTolerance)
    assert.deepEqual(checked.matrix, symmetrize(sample.matrix.slice(0, -1).map((row: number[]) => row.slice(0, -1))))
    assert.ok(checked.reciprocityResidual < .001)
  }
})
