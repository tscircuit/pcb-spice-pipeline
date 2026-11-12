import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { routedCopper } from '../support/routed-fixture'
import { segmentRoutes, type RouteWire, type RouteXY } from '../../src/board'
import { RouteFieldsSolver } from '../../src/extraction'
import { routeLadder, routedControl } from '../../src/simulation'
import { routedRequest } from '../../src/simulation/route-transient'
import { createNativeSolver } from '../../src/adapters'
import { parseSpiceVectors } from '../../src/observation'

/** Interpolate a signed edge at half of its actual settled swing. */
function midpoint(times: number[], volts: number[]): number {
  const direction = Math.sign(volts.at(-1)! - volts[0])
  const level = (volts[0] + volts.at(-1)!) / 2
  const i = volts.findIndex((value, index) => index > 0 && direction * volts[index - 1] < direction * level && direction * value >= direction * level)
  assert.ok(i > 0, 'matched step must cross half of its final swing')
  return times[i - 1] + (times[i] - times[i - 1]) * (level - volts[i - 1]) / (volts[i] - volts[i - 1])
}

test('native 5 ps matched steps propagate along the actual two-trace TSX ladder in both coupled modes', { skip: !process.env.NGSPICE_BIN && 'Set NGSPICE_BIN for the serial native physical-location oracle' }, async context => {
  const { circuitJson, scope } = await routedCopper()
  const geometry = segmentRoutes(circuitJson, scope)
  const fields = new RouteFieldsSolver({ geometry, artifactPrefix: 'matched-route' })
  fields.solve()
  const extracted = fields.getOutput().value
  assert.equal(extracted.slices.length, 1)
  const slice = extracted.slices[0]
  assert.equal(slice.wires.length, 2)
  const lengthMm = slice.end - slice.start
  assert.equal(lengthMm, 8)
  const native = createNativeSolver({ tools: { ngspice: process.env.NGSPICE_BIN }, timeoutMs: 10_000 })
  const evidence: Record<string, string | number>[] = []
  for (const sign of [1, -1]) {
    // Symmetric coupled traces have common/differential eigenvectors [1, ±1].
    // Their eigenvalues, rather than diagonal self terms, determine flight time and matching.
    const inductance = slice.line.L[0][0] + sign * slice.line.L[0][1]
    const capacitance = slice.line.C[0][0] + sign * slice.line.C[0][1]
    const impedance = Math.sqrt(inductance / capacitance)
    const expectedSeconds = lengthMm / 1000 * Math.sqrt(inductance * capacitance)
    assert.ok(Math.abs((slice.line.L[1][1] + sign * slice.line.L[1][0]) / inductance - 1) < 1e-10)
    assert.ok(Math.abs((slice.line.C[1][1] + sign * slice.line.C[1][0]) / capacitance - 1) < 1e-10)
    const names = new Map<string, string>()
    /** Allocate SPICE identities only at the physical positions requested by the routed assembler. */
    const endpoint = (wire: RouteWire, point: RouteXY): string => {
      const key = `${wire.id}:${point.map(value => value.toFixed(8)).join(',')}`
      if (!names.has(key)) names.set(key, `n${names.size}`)
      return names.get(key)!
    }
    // Retain production-like coarse cells from a 600 ps sizing edge, independently of the 5 ps electrical edge.
    const ladder = routeLadder(extracted, endpoint, 600e-12)
    assert.equal(ladder.cells, 4, 'two pi cells per physical trace')
    const near = slice.wires.map(wire => endpoint(wire, wire.a))
    const far = slice.wires.map(wire => endpoint(wire, wire.b))
    const deck = [
      'Matched routed physical-location oracle',
      '.options klu method=gear maxord=2 reltol=1e-7 abstol=1e-12 vntol=1e-9',
      ...near.flatMap((node, i) => [`VSTEP${i} source${i} 0 PULSE(0 ${i ? 2 * sign : 2} 20p 5p 5p 1n 2n)`, `RS${i} source${i} ${node} ${impedance}`]),
      ...far.map((node, i) => `RL${i} ${node} 0 ${impedance}`),
      ...ladder.lines,
      ...routedControl([...near, ...far].map(node => `v(${node})`).join(' '), 1e-13, 4e-10),
    ].join('\n') + '\n'
    const result = await native(routedRequest({ deck }))
    assert.doesNotMatch(result.stdout + result.stderr, /\b(error|fatal|aborted)\b/i)
    const vectors = new Map(parseSpiceVectors(result.files['waveform.raw']).map(vector => [vector.name, vector.values]))
    const times = vectors.get('time')!
    assert.equal(times.at(-1), 4e-10)
    const delays = near.map((node, i) => midpoint(times, vectors.get(`v(${far[i]})`)!) - midpoint(times, vectors.get(`v(${node})`)!))
    // With just two cells per trace, allow 5% lumped-ladder/causal-loss error; never fit node positions or L/C.
    assert.ok(delays.every(delay => Math.abs(delay / expectedSeconds - 1) < .05), `measured ${delays}, fields ${expectedSeconds}`)
    assert.ok(Math.abs(delays[0] - delays[1]) < 1e-15, 'both physical routes carry the selected mode')
    const measured = { mode: sign === 1 ? 'common' : 'differential', lengthMm, cells: ladder.cells, cellsPerTrace: 2, risePs: 5, impedanceOhms: impedance, delayPerMmPs: expectedSeconds / lengthMm * 1e12, expectedPs: expectedSeconds * 1e12, measuredPs: delays[0] * 1e12, errorPercent: (delays[0] / expectedSeconds - 1) * 100, tolerancePercent: 5 }
    evidence.push(measured)
    context.diagnostic(JSON.stringify(measured))
  }
  if (process.env.SI_IDEAL_STEP_EVIDENCE) await writeFile(process.env.SI_IDEAL_STEP_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n')
})
