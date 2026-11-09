import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { CircuitJson } from 'circuit-json'
import { channelSpice, fastHenryDeck, fasterCapDeck, type StageMatrices as ChannelMatrices, type Matrix } from '../../src/extraction'
import { geometryFromCircuitJson, type Modeling } from '../../src/board'
import { createNativeSolver } from '../../src/adapters'

const baseCircuit: CircuitJson = JSON.parse(await readFile(new URL('../fixtures/straight.circuit.json', import.meta.url), 'utf8'))
const baseModeling: Modeling = JSON.parse(await readFile(new URL('../fixtures/straight.modeling.json', import.meta.url), 'utf8'))
/** The straight board with a third routed signal added beside the first two, as a fresh copy each call. */
function threeSignals(): { circuit: CircuitJson; modeling: Modeling } {
  const circuit = structuredClone(baseCircuit)
  const modeling = structuredClone(baseModeling)
  for (const [oldId, newId, oldPcb, newPcb] of [['p0', 'p4', 'b0', 'b4'], ['p2', 'p5', 'b2', 'b5']]) {
    const source = circuit.find(element => element.type === 'source_port' && element.source_port_id === oldId)
    const pcb = circuit.find(element => element.type === 'pcb_port' && element.pcb_port_id === oldPcb)
    assert.ok(source?.type === 'source_port' && pcb?.type === 'pcb_port')
    circuit.push({ ...source, source_port_id: newId }, { ...pcb, pcb_port_id: newPcb, source_port_id: newId, y: 1.125 })
  }
  const sourceTrace = circuit.find(element => element.type === 'source_trace' && element.source_trace_id === 's0')
  const pcbTrace = circuit.find(element => element.type === 'pcb_trace' && element.pcb_trace_id === 't0')
  assert.ok(sourceTrace?.type === 'source_trace' && pcbTrace?.type === 'pcb_trace')
  circuit.push({ ...sourceTrace, source_trace_id: 's2', connected_source_port_ids: ['p4', 'p5'] }, {
    ...pcbTrace, pcb_trace_id: 't2', source_trace_id: 's2', route: pcbTrace.route.map((point, index) => {
      assert.equal(point.route_type, 'wire')
      return { ...point, y: 1.125, ...(index === 0 ? { start_pcb_port_id: 'b4' } : { end_pcb_port_id: 'b5' }) }
    }),
  })
  modeling.lanes.push({ port: 'DQ_NEIGHBOR', sourceTraceId: 's2', from: { sourcePortId: 'p4' }, to: { sourcePortId: 'p5' } })
  return { circuit, modeling }
}


const channel: ChannelMatrices = {
  R: [[4, .5, .25], [.5, 5, .75], [.25, .75, 6]],
  L: [[9e-9, 2e-9, -1e-9], [2e-9, 16e-9, 3e-9], [-1e-9, 3e-9, 25e-9]],
  C: [[7e-12, -1e-12, -2e-12], [-1e-12, 8e-12, -3e-12], [-2e-12, -3e-12, 9e-12]],
}

/** Asserts two values agree to a relative 1e-10, so netlist rounding to 12 digits still passes. */
const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected), 1e-30) * 1e-10,
    `expected ${expected}, received ${actual}`)
}

test('three-signal SPICE network reconstructs the complete extracted R, L and C matrices', () => {
  const deck = channelSpice([channel], 1)
  assert.match(deck, /^\.subckt CHANNEL IN0 IN1 IN2 OUT0 OUT1 OUT2 REF$/m)
  const reconstructed: ChannelMatrices = { R: [], L: [], C: [] }
  for (const kind of ['R', 'L', 'C'] as const) reconstructed[kind] = Array.from({ length: 3 }, () => [0, 0, 0])
  for (const line of deck.split('\n')) {
    const [name, , , value] = line.split(' ')
    const self = name.match(/^([RL])0_(\d)$/)
    if (self) reconstructed[self[1] as 'R' | 'L'][Number(self[2])][Number(self[2])] = Number(value)
    const cross = line.match(/^E0_(\d) .*value=\{(.+)\}$/)
    if (cross) for (const term of cross[2].matchAll(/([\deE.+-]+)\*i\(VS0_(\d)\)/g)) {
      reconstructed.R[Number(cross[1])][Number(term[2])] = Number(term[1].replace(/^\+/, ''))
    }
    const capacitor = name.match(/^C([GM])0[ab](\d)(?:_(\d))?$/)
    if (capacitor) {
      const i = Number(capacitor[2])
      const capacitance = Number(value)
      reconstructed.C[i][i] += capacitance
      if (capacitor[1] === 'M') {
        const j = Number(capacitor[3])
        reconstructed.C[j][j] += capacitance
        reconstructed.C[i][j] -= capacitance
        reconstructed.C[j][i] -= capacitance
      }
    }
  }
  for (const match of deck.matchAll(/^K0_(\d)_(\d) \S+ \S+ (\S+)$/gm)) {
    const i = Number(match[1])
    const j = Number(match[2])
    reconstructed.L[i][j] = reconstructed.L[j][i] = Number(match[3]) * Math.sqrt(reconstructed.L[i][i] * reconstructed.L[j][j])
  }
  for (const kind of ['R', 'L', 'C'] as const) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    close(reconstructed[kind][i][j], channel[kind][i][j])
  }
})

test('sectioning keeps every mutual and joins each signal to its own next stage', () => {
  const deck = channelSpice([channel, channel], 2)
  assert.equal([...deck.matchAll(/^K\d+_/gm)].length, 12)
  assert.equal([...deck.matchAll(/^E\d+_/gm)].length, 12)
  assert.equal([...deck.matchAll(/^CM\d+/gm)].length, 24)
  for (let section = 0; section < 4; section++) for (let lane = 0; lane < 3; lane++) {
    const before = section === 0 ? `IN${lane}` : `N${section}_${lane}`
    const after = section === 3 ? `OUT${lane}` : `N${section + 1}_${lane}`
    assert.ok(deck.includes(`VS${section}_${lane} ${before} S${section}_${lane} 0\n`))
    const inductance = deck.match(new RegExp(`^L${section}_${lane} L${section}_${lane} ${after} (\\S+)$`, 'm'))
    assert.ok(inductance)
    close(Number(inductance[1]), channel.L[lane][lane] / 2)
  }
})

test('malformed or nonpassive selected matrices fail before emitting a partial channel', () => {
  const differentSize: Matrix = [[1, 0], [0, 1]]
  assert.throws(() => channelSpice([channel, { ...channel, R: differentSize }], 1), /matrix_dimension/)
  assert.throws(() => channelSpice([{ ...channel, L: [[1, 2, 0], [2, 1, 0], [0, 0, 1]] }], 1), /passivity/)
  assert.throws(() => channelSpice([{ ...channel, C: [[3, .1, 0], [.1, 3, 0], [0, 0, 3]] }], 1), /capacitance_sign/)
  assert.throws(() => channelSpice([], 1), /matrix_dimension/)
})

test('native lossless-limit line preserves analytic delay, impedance and section/stage invariance', { skip: !process.env.NGSPICE_BIN }, async () => {
  const solve = createNativeSolver({ timeoutMs: 15000, tools: { ngspice: process.env.NGSPICE_BIN } })
  // 100 ps, 50 ohms. The 1 nOhm resistance is below the numerical tolerance;
  // channelSpice currently requires positive-definite R, including for this limit.
  const line = { R: [[1e-9]], L: [[5e-9]], C: [[2e-12]] }
  const frequency = 1e9
  const omega = 2 * Math.PI * frequency
  const delay = Math.sqrt(line.L[0][0] * line.C[0][0])
  const results: number[][] = []
  for (const [stages, sections] of [[1, 8], [1, 16], [2, 4]]) {
    const matrices = Array.from({ length: stages }, () => ({
      R: [[line.R[0][0] / stages]], L: [[line.L[0][0] / stages]], C: [[line.C[0][0] / stages]],
    }))
    const deck = ['Matched line with a nonzero reference', 'VREF ref 0 1.7', 'V1 source ref AC 1', 'RS source near 50', 'RL far ref 50',
      channelSpice(matrices, sections), 'XCHAN near far ref CHANNEL', '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17',
      `ac lin 1 ${frequency} ${frequency}`, 'wrdata line.dat v(near,ref) v(far,ref)', 'quit', '.endc', '.end'].join('\n')
    const output = await solve({ solver: 'ngspice', files: { 'line.cir': deck }, args: ['-n', '-b', 'line.cir'], outputFiles: ['line.dat'] })
    const values = output.files['line.dat'].trim().split('\n')[1].trim().split(/\s+/).map(Number)
    const measuredDelay = -Math.atan2(values[4], values[3]) / omega
    assert.ok(Math.abs(measuredDelay / delay - 1) < .001, 'phase delay agrees with sqrt(LC) within 0.1%')
    // Z_in = 50 V_near / (1 - V_near), independently of the line's emitted elements.
    const denominator = (1 - values[1]) ** 2 + values[2] ** 2
    const real = 50 * (values[1] * (1 - values[1]) - values[2] ** 2) / denominator
    const imaginary = 50 * values[2] / denominator
    assert.ok(Math.hypot(real - 50, imaginary) < .05, 'matched input impedance agrees with sqrt(L/C) within 0.1%')
    assert.ok(Math.hypot(values[3] - .5 * Math.cos(omega * delay), values[4] + .5 * Math.sin(omega * delay)) < .0005)
    results.push(values)
  }
  for (const values of results.slice(1)) for (let i = 1; i < values.length; i++) {
    assert.ok(Math.abs(values[i] - results[0][i]) < .0005, 'refining or splitting a physical stage preserves the waveform')
  }
})
