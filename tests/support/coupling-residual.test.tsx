import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import ReturnAgreement from '../fixtures/return-agreement'
import { renderCoreSignals } from './core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes, type SectionGeometry } from '../../src/board'
import { channelSpice, extractRoutes, routeCrossSection, solveCrossSection, type Matrix, type StageMatrices } from '../../src/extraction'
import { terminalInductance } from '../../src/simulation'
import { createNativeSolver } from '../../src/adapters'

interface Variant { name: string; panels: number; extent: number; sections: number; separate: boolean; quadrature: number }
interface Reference { peak_abs_v: number; min_v: number }
interface Errors { peakErrorMv: number; peakGateMv: number; minimumErrorMv: number; minimumGateMv: number }
const materials = { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 }
const baseline: Variant = { name: 'baseline', panels: 12, extent: 24, sections: 16, separate: false, quadrature: 0 }
const variants: Variant[] = [baseline,
  { ...baseline, name: 'finite-post-8', quadrature: 8 }, { ...baseline, name: 'finite-post-16', quadrature: 16 },
  { ...baseline, name: 'separate-16', separate: true }, { ...baseline, name: 'separate-64', separate: true, sections: 64 },
  { ...baseline, name: 'panels-24', panels: 24 }, { ...baseline, name: 'panels-48', panels: 48 },
  { ...baseline, name: 'extent-48', panels: 48, extent: 48 }]

/** Integrate the same 2D fields over the TSX route; retain the original 100 MHz resistance. */
function matrices(geometry: SectionGeometry, variant: Variant): { matrix: StageMatrices; sources: string[] } {
  const extracted = extractRoutes(geometry, materials)
  const sources = [...new Set(geometry.wires.map(wire => wire.source))].sort()
  const matrix: StageMatrices = { R: [], L: [], C: [] }
  for (const kind of ['R', 'L', 'C'] as const) matrix[kind] = sources.map(() => sources.map(() => 0))
  for (const slice of extracted.slices) {
    const line = variant.panels === 12 && variant.extent === 24 ? slice.line : solveCrossSection(routeCrossSection(geometry, slice, materials), { panelsPerEdge: variant.panels, interfaceExtent: variant.extent })
    const R = line.atFrequency(1e8).R
    for (const [i, wire] of slice.wires.entries()) for (const [j, other] of slice.wires.entries()) for (const kind of ['R', 'L', 'C'] as const) {
      matrix[kind][sources.indexOf(wire.source)][sources.indexOf(other.source)] += (kind === 'R' ? R : line[kind])[i][j] * (slice.end - slice.start) / 1000
    }
  }
  return { matrix, sources }
}

/** Bounded uniform-current rectangular-post sensitivity; no self-L or horizontal-end refit. */
function finitePosts(terminal: Matrix, positions: [number, number][], height: number, width: number, depth: number, count: number): void {
  const points = Array.from({ length: count ** 2 }, (_, k) => [((k % count + .5) / count - .5) * depth, ((Math.floor(k / count) + .5) / count - .5) * width])
  /** Half the image-post parallel-filament mutual, in H for millimetre dimensions. */
  const kernel = (spacing: number): number => .1e-9 * (2 * height * Math.asinh(2 * height / spacing) - Math.hypot(2 * height, spacing) + spacing)
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
    let mean = 0
    for (const a of points) for (const b of points) mean += kernel(Math.hypot(positions[i][0] - positions[j][0] + a[0] - b[0], positions[i][1] - positions[j][1] + a[1] - b[1])) / points.length ** 2
    const delta = mean - kernel(Math.hypot(positions[i][0] - positions[j][0], positions[i][1] - positions[j][1]))
    terminal[i][j] += delta
    terminal[j][i] += delta
  }
}

/** Move the existing terminal matrices outside all line shunt capacitors, preserving polarity. */
function separateEnds(terminal: Matrix): string[] {
  const lines: string[] = []
  for (const end of ['in', 'out']) {
    for (let i = 0; i < terminal.length; i++) lines.push(`LT${end}${i} ${end === 'in' ? `${end}${i}` : `${end}line${i}`} ${end === 'in' ? `${end}line${i}` : `${end}${i}`} ${terminal[i][i]}`)
    for (let i = 0; i < terminal.length; i++) for (let j = i + 1; j < terminal.length; j++) lines.push(`KT${end}${i}_${j} LT${end}${i} LT${end}${j} ${terminal[i][j] / Math.sqrt(terminal[i][i] * terminal[j][j])}`)
  }
  return lines
}

test('TSX residual coupling: three bounded hypotheses leave the fine-reference gates unresolved', { skip: !process.env.SI_COUPLING_REFEREE || !process.env.NGSPICE_BIN }, async t => {
  const reference = JSON.parse(await readFile(process.env.SI_COUPLING_REFEREE!, 'utf8')) as { cases: Record<string, { first_pulse_metrics: { 'openEMS-2': Record<string, Reference> } }> }
  const root = 'runs/coupling-residual'
  await mkdir(root, { recursive: true })
  const lock = await open(`${root}/native.lock`, 'wx')
  const results: Array<{ variant: string; name: string; terminalH: Matrix; metrics: Record<string, Errors> }> = []
  const solve = createNativeSolver({ tools: { ngspice: process.env.NGSPICE_BIN }, timeoutMs: 10000 })
  const exec = promisify(execFile)
  try {
    // Variant order keeps baseline and each hypothesis together; every native solve is awaited.
    for (const variant of variants) for (const [name, count, spacing, length] of [['1-0.3', 1, .3, 10], ['3-0.3', 3, .3, 10], ['3-1-short', 3, 1, 5]] as const) {
      const circuit = await renderCoreSignals(<ReturnAgreement count={count} spacing={spacing} length={length} />)
      const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
      const selected = new Set(circuit.filter(record => record.type === 'source_trace').flatMap(trace => trace.connected_source_port_ids))
      const geometry = segmentRoutes(circuit, channelCopperScope(circuit, selected, connectedSourceIds(circuit, ground.source_net_id), new Set(), 32))
      const { matrix, sources } = matrices(geometry, variant)
      assert.equal(sources.length, count)
      const signal = geometry.stack.copperLayers.find(layer => layer.name === 'top')!
      const plane = geometry.stack.copperLayers.find(layer => layer.name === 'bottom')!
      const pad = circuit.find(record => record.type === 'pcb_smtpad' && record.layer === 'top')!
      assert.ok(pad.type === 'pcb_smtpad' && pad.shape === 'rect')
      const positions = sources.map(source => geometry.wires.find(wire => wire.source === source)!.a)
      const terminal = terminalInductance(signal.zMinMm - plane.zMaxMm, pad.height, pad.width / 2, positions, matrix.L.map(row => row.map(value => value / (length / 1000))))
      if (variant.quadrature) finitePosts(terminal, positions, signal.zMinMm - plane.zMaxMm, pad.height, pad.width / 2, variant.quadrature)
      const pins = ['in', 'out'].flatMap(end => sources.map((_, i) => `${end}${variant.separate ? 'line' : ''}${i}`))
      const probes = ['out', 'in'].flatMap(end => sources.map((_, i) => `v(${end}${i})`))
      const deck = ['TSX residual coupling; original 30 ohm / 5 pF control', '.options klu method=gear maxord=2 reltol=1e-5',
        ...sources.flatMap((_, i) => [`V${i} src${i} 0 ${count === 3 && i === 1 ? '0' : 'pulse(0 3.3 2n 300p 300p 4n 10n)'}`, `R${i} src${i} in${i} 30`, `C${i} out${i} 0 5p`]),
        channelSpice([matrix], variant.sections, [], variant.separate ? {} : { input: terminal, output: terminal }), ...variant.separate ? separateEnds(terminal) : [],
        `XCH ${pins.join(' ')} 0 CHANNEL`, '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17', 'tran 1p 7.499n', `wrdata waveform.dat ${probes.join(' ')}`, 'quit', '.endc', '.end'].join('\n')
      const directory = `${root}/${variant.name}/${name}`
      await mkdir(directory, { recursive: true })
      await writeFile(`${directory}/simulation.cir`, deck)
      const processes = await exec('ps', ['-axo', 'comm='])
      assert.ok(!processes.stdout.split('\n').some(line => /(?:^|\/)(?:openEMS|ngspice|fasthenry|fastercap)$/i.test(line.trim())), 'another native solver is running')
      const output = await solve({ solver: 'ngspice', files: { 'simulation.cir': deck }, args: ['-b', 'simulation.cir'], outputFiles: ['waveform.dat'] })
      assert.doesNotMatch(output.stdout + output.stderr, /timestep too small|aborted|fatal|singular/i)
      await writeFile(`${directory}/waveform.dat`, output.files['waveform.dat'])
      const rows = output.files['waveform.dat'].trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number))
      assert.ok(rows.length > 7000 && rows.every(row => row.length === 1 + 2 * count && row.every(Number.isFinite)))
      const metrics = Object.fromEntries(Object.entries(reference.cases[name].first_pulse_metrics['openEMS-2']).map(([probe, fine]) => {
        const [end, index] = probe.split('-')
        const values = rows.map(row => row[1 + Number(index) + (end === 'near' ? count : 0)])
        return [probe, { peakErrorMv: (Math.max(...values.map(Math.abs)) - fine.peak_abs_v) * 1000, peakGateMv: fine.peak_abs_v * 10 + 1,
          minimumErrorMv: (Math.min(...values) - fine.min_v) * 1000, minimumGateMv: Math.abs(fine.min_v) * 10 + 1 }]
      }))
      results.push({ variant: variant.name, name, terminalH: terminal, metrics })
      // This is a rejection reproduction: no variant may be described as closing the original four failures.
      if (name === '3-0.3') assert.ok(Math.abs(metrics['far-1'].peakErrorMv) > metrics['far-1'].peakGateMv)
      if (name === '3-1-short') {
        assert.ok(Math.abs(metrics['far-0'].minimumErrorMv) > metrics['far-0'].minimumGateMv)
        for (const probe of ['near-1', 'far-1']) assert.ok(Math.abs(metrics[probe].peakErrorMv) > metrics[probe].peakGateMv)
      }
    }
    await writeFile(`${root}/comparison.json`, JSON.stringify({ variants, results }, null, 2) + '\n')
    t.diagnostic('24 serial ngspice captures; all four original gate failures remain for every variant. See runs/coupling-residual/comparison.json.')
  } finally {
    await lock.close()
    await rm(`${root}/native.lock`)
  }
})
