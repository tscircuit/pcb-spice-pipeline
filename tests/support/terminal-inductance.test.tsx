import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ReturnAgreement from '../fixtures/return-agreement'
import { renderCoreSignals } from './core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes } from '../../src/board'
import { channelSpice, extractRoutes, type StageMatrices } from '../../src/extraction'
import { terminalInductance } from '../../src/simulation'
import { routedNative } from '../../scripts/routed-native'
import referee from '../../docs/openems-referee-data.json'
import before from '../evidence/signal-levels/terminal-inductance-before.json'

test('TSX local-return terminal geometry improves the fine openEMS comparison without fitting', { skip: !process.env.NGSPICE_BIN }, async () => {
  const results = []
  const sections = Number(process.env.SI_TERMINAL_SECTIONS ?? 16)
  assert.ok([16, 32].includes(sections))
  for (const [name, count, spacing, length] of [['1-0.3', 1, .3, 10], ['3-0.3', 3, .3, 10], ['3-1-short', 3, 1, 5]] as const) {
    const circuit = await renderCoreSignals(<ReturnAgreement count={count} spacing={spacing} length={length} />)
    const ground = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
    const selected = new Set(circuit.filter(record => record.type === 'source_trace').flatMap(trace => trace.connected_source_port_ids))
    const scope = channelCopperScope(circuit, selected, connectedSourceIds(circuit, ground.source_net_id), new Set(), 32)
    const geometry = segmentRoutes(circuit, scope)
    const extracted = extractRoutes(geometry, { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 })
    const sources = [...new Set(geometry.wires.map(wire => wire.source))].sort()
    assert.equal(sources.length, count)
    const matrix: StageMatrices = { R: [], L: [], C: [] }
    for (const kind of ['R', 'L', 'C'] as const) {
      matrix[kind] = Array.from({ length: count }, () => Array(count).fill(0))
      for (const slice of extracted.slices) for (const [i, wire] of slice.wires.entries()) for (const [j, other] of slice.wires.entries()) {
        matrix[kind][sources.indexOf(wire.source)][sources.indexOf(other.source)] += (kind === 'R' ? slice.line.atFrequency(1e8).R : slice.line[kind])[i][j] * (slice.end - slice.start) / 1000
      }
    }
    const directory = resolve(`runs/terminal-inductance/s${sections}/${name}`)
    await mkdir(directory, { recursive: true })
    const pins = ['in', 'out'].flatMap(end => sources.map((_, i) => `${end}${i}`))
    const probes = ['out', 'in'].flatMap(end => sources.map((_, i) => `v(${end}${i})`))
    const signalLayer = geometry.stack.copperLayers.find(layer => layer.name === 'top')!
    const planeLayer = geometry.stack.copperLayers.find(layer => layer.name === 'bottom')!
    const pad = circuit.find(record => record.type === 'pcb_smtpad' && record.layer === 'top')!
    assert.ok(pad.type === 'pcb_smtpad' && pad.shape === 'rect')
    // openEMS's circuit volume occupies the inward half of this TSX pad, from trace to plane.
    const terminal = terminalInductance(signalLayer.zMinMm - planeLayer.zMaxMm, pad.height, pad.width / 2,
      sources.map((source) => geometry.wires.find(wire => wire.source === source)!.a), matrix.L.map(row => row.map(value => value / (length / 1000))))
    const deck = ['TSX local-return terminal reproduction; original 30 ohm / 5 pF control', '.options klu method=gear maxord=2 reltol=1e-5',
      ...sources.flatMap((_, i) => [`V${i} src${i} 0 ${count === 3 && i === 1 ? '0' : 'pulse(0 3.3 2n 300p 300p 4n 10n)'}`, `R${i} src${i} in${i} 30`, `C${i} out${i} 0 5p`]),
      channelSpice([matrix], sections, [], { input: terminal, output: terminal }), `XCH ${pins.join(' ')} 0 CHANNEL`, '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17', 'tran 1p 7.499n', `wrdata waveform.dat ${probes.join(' ')}`, 'quit', '.endc', '.end'].join('\n')
    await writeFile(`${directory}/simulation.cir`, deck)
    await routedNative(directory, 7.499e-9)
    const rows = (await readFile(`${directory}/waveform.dat`, 'utf8')).trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number))
    const fine = referee.cases[name].first_pulse_metrics['openEMS-2'] as Record<string, { max_v: number; min_v: number; peak_abs_v: number }>
    const metrics = Object.fromEntries(Object.entries(fine).map(([probe, reference]) => {
      const [end, index] = probe.split('-')
      const values = rows.map(row => row[1 + Number(index) + (end === 'near' ? count : 0)])
      const peak = Math.max(...values.map(Math.abs))
      const minimum = Math.min(...values)
      return [probe, { peak_v: peak, peak_error_mv: (peak - reference.peak_abs_v) * 1000, peak_gate_mv: reference.peak_abs_v * 10 + 1,
        minimum_v: minimum, minimum_error_mv: (minimum - reference.min_v) * 1000, minimum_gate_mv: Math.abs(reference.min_v) * 10 + 1 }]
    }))
    results.push({ name, matrix, terminal_h: terminal, metrics })
    assert.ok(Math.abs(metrics['far-0'].peak_error_mv) < metrics['far-0'].peak_gate_mv, `${name}: driven peak within 1% + 1 mV`)
    const baseline = before.results.find(result => result.name === name)!.metrics
    assert.ok(Math.abs(metrics['far-0'].minimum_error_mv) < Math.abs(baseline['far-0'].minimum_error_mv), `${name}: driven undershoot error improves`)
    if (count === 3) assert.ok(Math.abs(metrics['far-1'].peak_error_mv) < Math.abs(baseline['far-1']!.peak_error_mv), `${name}: far-victim error improves; the saved gates still decide qualification`)
  }
  await writeFile(`runs/terminal-inductance/s${sections}/comparison.json`, JSON.stringify({ reference: 'docs/openems-referee-data.json; fine PEC/local-return first pulse; no tail extrapolation', sections, results }, null, 2) + '\n')
})
