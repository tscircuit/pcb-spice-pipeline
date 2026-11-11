import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ReturnAgreement from '../fixtures/return-agreement'
import { renderCoreSignals } from './core-render'
import { channelCopperScope, connectedSourceIds, segmentRoutes } from '../../src/board'
import { channelSpice, extractRoutes, type StageMatrices } from '../../src/extraction'
import { routedNative } from '../../scripts/routed-native'
import referee from '../../docs/openems-referee-data.json'

test('TSX local-return terminals expose the missing inductance against fine openEMS', { skip: !process.env.NGSPICE_BIN }, async () => {
  const results = []
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
    const directory = resolve(`runs/terminal-inductance/${name}`)
    await mkdir(directory, { recursive: true })
    const pins = ['in', 'out'].flatMap(end => sources.map((_, i) => `${end}${i}`))
    const probes = ['out', 'in'].flatMap(end => sources.map((_, i) => `v(${end}${i})`))
    const deck = ['TSX local-return terminal reproduction; original 30 ohm / 5 pF control', '.options klu method=gear maxord=2 reltol=1e-5',
      ...sources.flatMap((_, i) => [`V${i} src${i} 0 ${count === 3 && i === 1 ? '0' : 'pulse(0 3.3 2n 300p 300p 4n 10n)'}`, `R${i} src${i} in${i} 30`, `C${i} out${i} 0 5p`]),
      channelSpice([matrix], 16), `XCH ${pins.join(' ')} 0 CHANNEL`, '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17', 'tran 1p 7.499n', `wrdata waveform.dat ${probes.join(' ')}`, 'quit', '.endc', '.end'].join('\n')
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
    results.push({ name, matrix, metrics })
    if (count === 3) assert.ok(Math.abs(metrics['far-1'].peak_error_mv) > metrics['far-1'].peak_gate_mv, `${name}: uncorrected far-victim peak misses 1% + 1 mV`)
    else assert.ok(Math.abs(metrics['far-0'].minimum_error_mv) > metrics['far-0'].minimum_gate_mv, 'single-line undershoot exposes the terminal miss')
  }
  await writeFile('runs/terminal-inductance/comparison.json', JSON.stringify({ reference: 'docs/openems-referee-data.json; fine PEC/local-return first pulse; no tail extrapolation', results }, null, 2) + '\n')
})
