import React from 'react'
import { Circuit, simulation } from '@tscircuit/core'
import { getSvgFromGraphicsObject, type GraphicsObject } from 'graphics-debug'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedPipelineSolver } from '../../src/pipeline'
import { formatSpiceVectors } from '../../src/observation'
import type { SolverContext } from '../../src/solver'
import type { CircuitJson } from '../../src/board'

// Original synthetic model for drawing tests only; no vendor tables or native claims.
const source = `[IBIS Ver] 4.2
[Component] LVC1G04_DCK
[Manufacturer] Drawing fixture
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
2 A LVC1G04_IN_33
3 GND GND
4 Y LVC1G04_OUT_33
5 VCC POWER
[Model] LVC1G04_OUT_33
Model_type Output
Polarity Non-Inverting
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[Pullup]
-3.3 .066 .066 .066
0 0 0 0
6.6 -.132 -.132 -.132
[Pulldown]
-3.3 -.066 -.066 -.066
0 0 0 0
6.6 .132 .132 .132
[Ramp]
dV/dt_r 1.98/1n 1.98/1n 1.98/1n
dV/dt_f 1.98/1n 1.98/1n 1.98/1n
R_load = 50
${(['rising', 'falling'] as const)
  .flatMap((kind) =>
    [0, 3.3].map(
      (voltage) =>
        `[${kind === 'rising' ? 'Rising' : 'Falling'} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n` +
        [
          [0, 0],
          [0.2, 0],
          [0.4, 0.5],
          [0.6, 1],
          [0.8, 1],
          [1, 1],
          [2, 1],
          [4, 1],
        ]
          .map(([time, fraction]) => {
            const value = voltage / 2 + 1.65 * (kind === 'rising' ? fraction : 1 - fraction)
            return `${time}n ${value} ${value} ${value}`
          })
          .join('\n'),
    ),
  )
  .join('\n')}
[Model] LVC1G04_IN_33
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[End]
`
const fixtures = new Map<number, Promise<{ root: RoutedPipelineSolver }>>()

/** Solve real TwoTraceBoard TSX with original drawing-only model tables, once per test file. */
export function routedVisualFixture(blocks: number = 1): Promise<{ root: RoutedPipelineSolver }> {
  const existing = fixtures.get(blocks)
  if (existing) return existing
  const fixture = (async () => {
    const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(source) } })
    const board = TwoTraceBoard({ 'bit-rate': '400Mbps', 'duration-seconds': 4e-9 })
    const tree = blocks === 1 ? board : React.cloneElement(board, {},
      ...React.Children.toArray(board.props.children).filter(child => !React.isValidElement(child) || child.type !== simulation.pcbtransientchannelsimulation),
      ...[0, 1].map(i => <simulation.pcbtransientchannelsimulation key={i} name={`BLOCK${i}`} bitRate="400Mbps" duration={4e-9}>
        <simulation.pcbchannel name={`DATA${i}`} driverRef={`.TX${i} > .Y`} receiverRef={`.RX${i} > .A`} pattern="01" />
      </simulation.pcbtransientchannelsimulation>),
    )
    circuit.add(tree)
    await circuit.renderUntilSettled()
    // Synthetic engine IO for drawing only; these curves are not solver evidence.
    const context: SolverContext = { progress: (): void => undefined, runSolver: async request => {
      const deck = request.files['simulation.cir']
      const duration = Number(/^\.tran\s+\S+\s+(\S+)/m.exec(deck)![1])
      const saved = /^\.save (.+)$/m.exec(deck)![1]
      const names = [...new Set([...saved.matchAll(/v\(([^)]+)\)/g)].map(match => match[1]))]
      return { stdout: '', stderr: '', files: { 'waveform.raw': formatSpiceVectors([
        { name: 'time', type: 'time', values: [0, duration * .2, duration * .21, duration * .25, duration] },
        ...names.map((name, i) => ({ name: `v(${name})`, type: 'voltage', values: i === 0 ? [0, .8, 2.1, 1.5, 1.5] : i === 1 ? [0, .1, -.5, .05, 0] : [3.3, 3.3, 3.3, 3.3, 3.3] })),
      ]) } }
    } }
    const root = new RoutedPipelineSolver({
      circuitJson: circuit.getCircuitJson() as CircuitJson,
      ibisSources: { 'models/sn74lvc1g04.ibs': source },
      scopeDistanceMm: 1,
    }, context)
    await root.solveAsync()
    return { root }
  })()
  fixtures.set(blocks, fixture)
  return fixture
}

/** Compare actual exported SVG, including explicit text and fills; snapshots contain no vendor data. */
export function assertRouteVisual(drawing: GraphicsObject, module: string, name: string): void {
  const path = join(import.meta.dirname, '..', module, '__snapshots__', `${name}.svg.snap`)
  // Ignore sub-micro-atlas-unit V8/JavaScriptCore rounding in display coordinates only.
  const normalized: GraphicsObject = JSON.parse(JSON.stringify(drawing, (_key, value) => (typeof value === 'number' ? Number(value.toFixed(6)) : value)))
  const svg = getSvgFromGraphicsObject(normalized, { svgWidth: 1100, svgHeight: 800, backgroundColor: 'white', includeTextLabels: false })
  if (process.env.UPDATE_ROUTED_VISUALS === '1') {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, svg)
  }
  assert.equal(svg, readFileSync(path, 'utf8'), `${module}/${name} SVG changed; inspect PNGs before updating snapshots`)
}
